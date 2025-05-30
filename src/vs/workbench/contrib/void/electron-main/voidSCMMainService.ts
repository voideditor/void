import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { IVoidSCMService } from '../common/voidSCMTypes.js'
import { promisify } from 'util'
import { exec as _exec } from 'child_process'

interface NumStat {
	file: string
	added: number
	removed: number
}

const exec = promisify(_exec)

const git = async (command: string, path: string): Promise<string> => {
	const { stdout, stderr } = await exec(`${command}`, { cwd: path })
	if (stderr) {
		throw new Error(stderr)
	}
	return stdout.trim()
}

const getNumStat = async (path: string): Promise<NumStat[]> => {
	// Get both staged and unstaged changes
	const [stagedOutput, unstagedOutput] = await Promise.all([
		git('git diff --cached --numstat', path).catch(() => ''), // staged changes
		git('git diff --numstat', path).catch(() => '') // unstaged changes
	])
	
	const parseOutput = (output: string) => {
		if (!output.trim()) return []
		return output
			.split('\n')
			.filter(line => line.trim())
			.map((line) => {
				const [added, removed, file] = line.split('\t')
				return {
					file,
					added: parseInt(added, 10) || 0,
					removed: parseInt(removed, 10) || 0,
				}
			})
	}
	
	const stagedStats = parseOutput(stagedOutput)
	const unstagedStats = parseOutput(unstagedOutput)
	
	// Combine and deduplicate by file, summing the changes
	const fileMap = new Map<string, NumStat>()
	
	for (const stat of [...stagedStats, ...unstagedStats]) {
		const existing = fileMap.get(stat.file)
		if (existing) {
			existing.added += stat.added
			existing.removed += stat.removed
		} else {
			fileMap.set(stat.file, { ...stat })
		}
	}
	
	return Array.from(fileMap.values())
}

const getSampledDiff = async (file: string, path: string): Promise<string> => {
	// Get both staged and unstaged diffs
	const [stagedDiff, unstagedDiff] = await Promise.all([
		git(`git diff --cached --unified=0 --no-color -- "${file}"`, path).catch(() => ''), // staged changes
		git(`git diff --unified=0 --no-color -- "${file}"`, path).catch(() => '') // unstaged changes
	])
	
	let combinedDiff = ''
	if (stagedDiff.trim()) {
		combinedDiff += `=== STAGED CHANGES ===\n${stagedDiff}\n\n`
	}
	if (unstagedDiff.trim()) {
		combinedDiff += `=== UNSTAGED CHANGES ===\n${unstagedDiff}\n\n`
	}
	
	return combinedDiff.slice(0, 2000)
}

export class VoidSCMService implements IVoidSCMService {
	readonly _serviceBrand: undefined

	async gitStat(path: string): Promise<string> {
		// Get both staged and unstaged stats
		const [stagedStat, unstagedStat] = await Promise.all([
			git('git diff --cached --stat', path).catch(() => ''), // staged changes
			git('git diff --stat', path).catch(() => '') // unstaged changes
		])
		
		let combinedStat = ''
		if (stagedStat.trim()) {
			combinedStat += `Staged changes:\n${stagedStat}\n\n`
		}
		if (unstagedStat.trim()) {
			combinedStat += `Unstaged changes:\n${unstagedStat}\n\n`
		}
		
		// If neither staged nor unstaged changes, check if there are any changes at all
		if (!combinedStat.trim()) {
			// This will show changes between HEAD and working directory (includes staged changes)
			const allChanges = await git('git diff HEAD --stat', path).catch(() => '')
			if (allChanges.trim()) {
				combinedStat = `All changes:\n${allChanges}`
			}
		}
		
		return combinedStat.trim()
	}

	async gitSampledDiffs(path: string): Promise<string> {
		const numStatList = await getNumStat(path)
		const topFiles = numStatList
			.sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
			.slice(0, 10)
		const diffs = await Promise.all(topFiles.map(async ({ file }) => ({ file, diff: await getSampledDiff(file, path) })))
		return diffs.map(({ file, diff }) => `==== ${file} ====\n${diff}`).join('\n\n')
	}

	gitBranch(path: string): Promise<string> {
		return git('git branch --show-current', path)
	}

	gitLog(path: string): Promise<string> {
		return git('git log --pretty=format:"%h|%s|%ad" --date=short --no-merges -n 5', path)
	}
}

registerSingleton(IVoidSCMService, VoidSCMService, InstantiationType.Delayed)
