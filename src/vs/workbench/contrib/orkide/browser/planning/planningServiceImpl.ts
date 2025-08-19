/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { generateUuid } from 'vs/base/common/uuid';
import { 
	IOrkidePlanningService, 
	IPlan, 
	IPlanStep,
	IPlanTemplate,
	IPlanExecution,
	IValidationResult,
	IDependencyAnalysis,
	PlanStatus,
	PlanPriority,
	StepType,
	StepStatus,
	TemplateCategory,
	ValidationType,
	ConstraintType,
	RiskProbability,
	RiskImpact,
	RiskStatus,
	LogLevel
} from './planningService';
import { IOrkideContextAwarenessService } from '../contextAwareness/contextAwarenessService';
import { IOrkideMultiAgentService, TaskType } from '../multiAgent/multiAgentService';

export class OrkidePlanningService extends Disposable implements IOrkidePlanningService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePlans = this._register(new Emitter<IPlan[]>());
	readonly onDidChangePlans: Event<IPlan[]> = this._onDidChangePlans.event;

	private readonly _onDidChangeExecution = this._register(new Emitter<IPlanExecution>());
	readonly onDidChangeExecution: Event<IPlanExecution> = this._onDidChangeExecution.event;

	private _plans: IPlan[] = [];
	private _templates: IPlanTemplate[] = [];
	private _executions: Map<string, IPlanExecution> = new Map();

	constructor(
		@IOrkideContextAwarenessService private readonly contextService: IOrkideContextAwarenessService,
		@IOrkideMultiAgentService private readonly multiAgentService: IOrkideMultiAgentService
	) {
		super();
		this._initializeTemplates();
	}

	getPlans(): IPlan[] {
		return [...this._plans];
	}

	getPlan(id: string): IPlan | undefined {
		return this._plans.find(p => p.id === id);
	}

	async createPlan(planData: Omit<IPlan, 'id' | 'createdAt' | 'updatedAt'>): Promise<IPlan> {
		const plan: IPlan = {
			...planData,
			id: generateUuid(),
			createdAt: Date.now(),
			updatedAt: Date.now()
		};

		// Assign IDs to steps
		plan.steps = plan.steps.map(step => ({
			...step,
			id: step.id || generateUuid(),
			createdAt: step.createdAt || Date.now(),
			updatedAt: step.updatedAt || Date.now()
		}));

		this._plans.push(plan);
		this._onDidChangePlans.fire(this._plans);

		return plan;
	}

	async updatePlan(id: string, updates: Partial<IPlan>): Promise<IPlan> {
		const planIndex = this._plans.findIndex(p => p.id === id);
		if (planIndex === -1) {
			throw new Error(`Plan ${id} not found`);
		}

		const plan = this._plans[planIndex];
		this._plans[planIndex] = {
			...plan,
			...updates,
			id, // Ensure ID doesn't change
			updatedAt: Date.now()
		};

		this._onDidChangePlans.fire(this._plans);
		return this._plans[planIndex];
	}

	async deletePlan(id: string): Promise<void> {
		const planIndex = this._plans.findIndex(p => p.id === id);
		if (planIndex >= 0) {
			// Cancel execution if running
			const execution = this._executions.get(id);
			if (execution && execution.completedAt === undefined) {
				await this.cancelExecution(id);
			}

			this._plans.splice(planIndex, 1);
			this._executions.delete(id);
			this._onDidChangePlans.fire(this._plans);
		}
	}

	async generatePlan(requirements: string, context?: Partial<IPlanContext>): Promise<IPlan> {
		// Analyze requirements and generate plan structure
		const contextData = await this.contextService.getContextData();
		
		const plan: Omit<IPlan, 'id' | 'createdAt' | 'updatedAt'> = {
			title: this._extractTitle(requirements),
			description: requirements,
			objective: this._extractObjective(requirements),
			status: PlanStatus.Draft,
			priority: this._determinePriority(requirements),
			steps: await this._generateSteps(requirements),
			dependencies: [],
			tags: this._extractTags(requirements),
			context: {
				workspaceRoot: contextData.workspaceRoot,
				targetFiles: contextData.openFiles,
				userRequirements: requirements,
				constraints: this._identifyConstraints(requirements),
				assumptions: this._identifyAssumptions(requirements),
				risks: this._identifyRisks(requirements),
				...context
			},
			metadata: {
				version: 1,
				reviewers: [],
				approvers: []
			}
		};

		return this.createPlan(plan);
	}

	getTemplates(): IPlanTemplate[] {
		return [...this._templates];
	}

	async createPlanFromTemplate(templateId: string, customization?: Partial<IPlan>): Promise<IPlan> {
		const template = this._templates.find(t => t.id === templateId);
		if (!template) {
			throw new Error(`Template ${templateId} not found`);
		}

		const contextData = await this.contextService.getContextData();

		const plan: Omit<IPlan, 'id' | 'createdAt' | 'updatedAt'> = {
			title: customization?.title || `${template.name} Plan`,
			description: customization?.description || template.description,
			objective: customization?.objective || `Complete ${template.name.toLowerCase()}`,
			status: PlanStatus.Draft,
			priority: customization?.priority || PlanPriority.Medium,
			estimatedDuration: template.estimatedDuration,
			steps: template.steps.map(stepTemplate => ({
				...stepTemplate,
				id: generateUuid(),
				status: StepStatus.Pending,
				createdAt: Date.now(),
				updatedAt: Date.now()
			})),
			dependencies: customization?.dependencies || [],
			tags: customization?.tags || [template.category],
			context: {
				workspaceRoot: contextData.workspaceRoot,
				targetFiles: contextData.openFiles,
				userRequirements: customization?.description || template.description,
				constraints: template.defaultConstraints,
				assumptions: [],
				risks: [],
				...customization?.context
			},
			metadata: {
				version: 1,
				reviewers: [],
				approvers: [],
				...customization?.metadata
			}
		};

		return this.createPlan(plan);
	}

	async executePlan(planId: string): Promise<IPlanExecution> {
		const plan = this.getPlan(planId);
		if (!plan) {
			throw new Error(`Plan ${planId} not found`);
		}

		const execution: IPlanExecution = {
			planId,
			startedAt: Date.now(),
			progress: {
				totalSteps: plan.steps.length,
				completedSteps: 0,
				failedSteps: 0,
				skippedSteps: 0,
				percentage: 0
			},
			logs: [{
				timestamp: Date.now(),
				level: LogLevel.Info,
				message: `Started execution of plan: ${plan.title}`
			}]
		};

		this._executions.set(planId, execution);
		this._onDidChangeExecution.fire(execution);

		// Update plan status
		await this.updatePlan(planId, { status: PlanStatus.InProgress });

		// Execute steps sequentially (in production, this could be more sophisticated)
		this._executeStepsSequentially(plan, execution);

		return execution;
	}

	async pauseExecution(planId: string): Promise<void> {
		const execution = this._executions.get(planId);
		if (execution) {
			execution.pausedAt = Date.now();
			execution.logs.push({
				timestamp: Date.now(),
				level: LogLevel.Info,
				message: 'Execution paused'
			});
			this._onDidChangeExecution.fire(execution);
		}
	}

	async resumeExecution(planId: string): Promise<void> {
		const execution = this._executions.get(planId);
		if (execution && execution.pausedAt) {
			execution.pausedAt = undefined;
			execution.logs.push({
				timestamp: Date.now(),
				level: LogLevel.Info,
				message: 'Execution resumed'
			});
			this._onDidChangeExecution.fire(execution);
		}
	}

	async cancelExecution(planId: string): Promise<void> {
		const execution = this._executions.get(planId);
		if (execution) {
			execution.completedAt = Date.now();
			execution.logs.push({
				timestamp: Date.now(),
				level: LogLevel.Warning,
				message: 'Execution cancelled'
			});
			this._onDidChangeExecution.fire(execution);

			// Update plan status
			await this.updatePlan(planId, { status: PlanStatus.Cancelled });
		}
	}

	getExecution(planId: string): IPlanExecution | undefined {
		return this._executions.get(planId);
	}

	async validatePlan(plan: IPlan): Promise<IValidationResult> {
		const errors: any[] = [];
		const warnings: any[] = [];
		const suggestions: string[] = [];

		// Validate basic structure
		if (!plan.title.trim()) {
			errors.push({ message: 'Plan title is required', severity: 'error', code: 'MISSING_TITLE' });
		}

		if (plan.steps.length === 0) {
			errors.push({ message: 'Plan must have at least one step', severity: 'error', code: 'NO_STEPS' });
		}

		// Validate step dependencies
		const stepIds = new Set(plan.steps.map(s => s.id));
		plan.steps.forEach(step => {
			step.dependencies.forEach(depId => {
				if (!stepIds.has(depId)) {
					errors.push({
						stepId: step.id,
						message: `Step depends on non-existent step: ${depId}`,
						severity: 'error',
						code: 'INVALID_DEPENDENCY'
					});
				}
			});
		});

		// Check for circular dependencies
		const cycles = this._findCircularDependencies(plan.steps);
		cycles.forEach(cycle => {
			errors.push({
				message: `Circular dependency detected: ${cycle.join(' -> ')}`,
				severity: 'error',
				code: 'CIRCULAR_DEPENDENCY'
			});
		});

		// Suggestions
		if (plan.steps.length > 10) {
			suggestions.push('Consider breaking down the plan into smaller sub-plans for better manageability');
		}

		if (!plan.estimatedDuration) {
			suggestions.push('Add estimated duration for better planning');
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			suggestions
		};
	}

	async estimateDuration(plan: IPlan): Promise<number> {
		let totalDuration = 0;

		for (const step of plan.steps) {
			if (step.estimatedDuration) {
				totalDuration += step.estimatedDuration;
			} else {
				// Default estimates based on step type
				totalDuration += this._getDefaultStepDuration(step.type);
			}
		}

		// Add buffer for dependencies and coordination
		const bufferMultiplier = 1.2;
		return Math.round(totalDuration * bufferMultiplier);
	}

	async analyzeDependencies(plan: IPlan): Promise<IDependencyAnalysis> {
		const cycles = this._findCircularDependencies(plan.steps);
		const criticalPath = this._findCriticalPath(plan.steps);
		const parallelizable = this._findParallelizableSteps(plan.steps);
		const bottlenecks = this._findBottlenecks(plan.steps);

		return {
			cycles,
			criticalPath,
			parallelizable,
			bottlenecks
		};
	}

	async optimizePlan(plan: IPlan): Promise<IPlan> {
		// Create optimized copy
		const optimizedPlan = { ...plan };
		
		// Reorder steps for optimal execution
		optimizedPlan.steps = this._optimizeStepOrder(plan.steps);
		
		// Update estimated duration
		optimizedPlan.estimatedDuration = await this.estimateDuration(optimizedPlan);
		
		return optimizedPlan;
	}

	private async _executeStepsSequentially(plan: IPlan, execution: IPlanExecution): Promise<void> {
		for (const step of plan.steps) {
			if (execution.pausedAt || execution.completedAt) {
				break; // Execution paused or cancelled
			}

			execution.currentStepId = step.id;
			this._onDidChangeExecution.fire(execution);

			try {
				await this._executeStep(step, execution);
				execution.progress.completedSteps++;
			} catch (error) {
				execution.progress.failedSteps++;
				execution.logs.push({
					timestamp: Date.now(),
					level: LogLevel.Error,
					stepId: step.id,
					message: `Step failed: ${error}`,
					details: error
				});
			}

			execution.progress.percentage = 
				(execution.progress.completedSteps / execution.progress.totalSteps) * 100;
			this._onDidChangeExecution.fire(execution);
		}

		// Complete execution
		execution.completedAt = Date.now();
		execution.currentStepId = undefined;
		
		const finalStatus = execution.progress.failedSteps > 0 ? PlanStatus.Completed : PlanStatus.Completed;
		await this.updatePlan(plan.id, { status: finalStatus });

		execution.logs.push({
			timestamp: Date.now(),
			level: LogLevel.Info,
			message: `Execution completed. ${execution.progress.completedSteps}/${execution.progress.totalSteps} steps successful`
		});

		this._onDidChangeExecution.fire(execution);
	}

	private async _executeStep(step: IPlanStep, execution: IPlanExecution): Promise<void> {
		execution.logs.push({
			timestamp: Date.now(),
			level: LogLevel.Info,
			stepId: step.id,
			message: `Executing step: ${step.title}`
		});

		// Convert step to multi-agent task
		const taskType = this._stepTypeToTaskType(step.type);
		
		const taskResult = await this.multiAgentService.executeTask({
			description: step.description,
			type: taskType,
			priority: 2, // Medium priority
			context: {
				files: step.resources.filter(r => r.uri).map(r => r.uri!),
				userPrompt: step.description,
				additionalContext: step
			},
			assignedAgents: step.assignedAgent ? [step.assignedAgent] : [],
			dependencies: step.dependencies
		});

		if (taskResult.success) {
			step.status = StepStatus.Completed;
			step.output = {
				type: 'analysis', // Would be determined by step type
				content: taskResult.output,
				metadata: taskResult.metadata
			};
		} else {
			step.status = StepStatus.Failed;
			throw new Error(taskResult.errors?.join(', ') || 'Step execution failed');
		}
	}

	private _stepTypeToTaskType(stepType: StepType): TaskType {
		switch (stepType) {
			case StepType.Implementation:
				return TaskType.CodeGeneration;
			case StepType.Review:
				return TaskType.CodeReview;
			case StepType.Testing:
				return TaskType.Testing;
			case StepType.Documentation:
				return TaskType.Documentation;
			default:
				return TaskType.Analysis;
		}
	}

	private _extractTitle(requirements: string): string {
		// Simple title extraction from first sentence
		const firstSentence = requirements.split('.')[0];
		return firstSentence.length > 50 ? firstSentence.substring(0, 47) + '...' : firstSentence;
	}

	private _extractObjective(requirements: string): string {
		// Extract main objective from requirements
		const lines = requirements.split('\n');
		return lines[0] || requirements.substring(0, 100);
	}

	private _determinePriority(requirements: string): PlanPriority {
		const urgent = /urgent|critical|asap|immediately/i.test(requirements);
		const important = /important|priority|high/i.test(requirements);
		
		if (urgent) return PlanPriority.Critical;
		if (important) return PlanPriority.High;
		return PlanPriority.Medium;
	}

	private async _generateSteps(requirements: string): Promise<IPlanStep[]> {
		// Simple step generation based on common patterns
		const steps: Omit<IPlanStep, 'id' | 'createdAt' | 'updatedAt'>[] = [
			{
				title: 'Analysis',
				description: 'Analyze requirements and current state',
				type: StepType.Analysis,
				status: StepStatus.Pending,
				dependencies: [],
				resources: [],
				validation: {
					criteria: [{
						id: generateUuid(),
						description: 'Requirements are clearly understood',
						type: ValidationType.Functionality,
						condition: 'manual_review'
					}],
					automated: false,
					required: true
				}
			},
			{
				title: 'Design',
				description: 'Create design and architecture',
				type: StepType.Design,
				status: StepStatus.Pending,
				dependencies: [],
				resources: [],
				validation: {
					criteria: [{
						id: generateUuid(),
						description: 'Design meets requirements',
						type: ValidationType.Functionality,
						condition: 'design_review'
					}],
					automated: false,
					required: true
				}
			},
			{
				title: 'Implementation',
				description: 'Implement the solution',
				type: StepType.Implementation,
				status: StepStatus.Pending,
				dependencies: [],
				resources: [],
				validation: {
					criteria: [{
						id: generateUuid(),
						description: 'Code compiles without errors',
						type: ValidationType.CodeQuality,
						condition: 'compilation_check'
					}],
					automated: true,
					required: true
				}
			}
		];

		return steps.map(step => ({
			...step,
			id: generateUuid(),
			createdAt: Date.now(),
			updatedAt: Date.now()
		}));
	}

	private _extractTags(requirements: string): string[] {
		const tags: string[] = [];
		
		if (/test|testing/i.test(requirements)) tags.push('testing');
		if (/bug|fix|issue/i.test(requirements)) tags.push('bugfix');
		if (/feature|new/i.test(requirements)) tags.push('feature');
		if (/refactor|cleanup/i.test(requirements)) tags.push('refactoring');
		if (/document|docs/i.test(requirements)) tags.push('documentation');
		
		return tags;
	}

	private _identifyConstraints(requirements: string): any[] {
		const constraints: any[] = [];
		
		// Time constraints
		const timeMatch = requirements.match(/(\d+)\s*(day|week|month)s?/i);
		if (timeMatch) {
			constraints.push({
				type: ConstraintType.Time,
				description: `Complete within ${timeMatch[0]}`,
				value: timeMatch[0]
			});
		}
		
		return constraints;
	}

	private _identifyAssumptions(requirements: string): string[] {
		// Simple assumption identification
		return [
			'Current codebase is stable',
			'Required dependencies are available',
			'Development environment is properly configured'
		];
	}

	private _identifyRisks(requirements: string): any[] {
		return [
			{
				id: generateUuid(),
				description: 'Requirements may change during implementation',
				probability: RiskProbability.Medium,
				impact: RiskImpact.Medium,
				mitigation: 'Regular stakeholder communication and iterative development',
				status: RiskStatus.Identified
			}
		];
	}

	private _findCircularDependencies(steps: IPlanStep[]): string[][] {
		// Simple cycle detection using DFS
		const cycles: string[][] = [];
		const visited = new Set<string>();
		const recursionStack = new Set<string>();

		const dfs = (stepId: string, path: string[]): void => {
			if (recursionStack.has(stepId)) {
				const cycleStart = path.indexOf(stepId);
				cycles.push(path.slice(cycleStart));
				return;
			}

			if (visited.has(stepId)) {
				return;
			}

			visited.add(stepId);
			recursionStack.add(stepId);

			const step = steps.find(s => s.id === stepId);
			if (step) {
				step.dependencies.forEach(depId => {
					dfs(depId, [...path, stepId]);
				});
			}

			recursionStack.delete(stepId);
		};

		steps.forEach(step => {
			if (!visited.has(step.id)) {
				dfs(step.id, []);
			}
		});

		return cycles;
	}

	private _findCriticalPath(steps: IPlanStep[]): string[] {
		// Simplified critical path calculation
		// In production, this would use proper CPM algorithm
		return steps
			.filter(step => step.dependencies.length === 0)
			.map(step => step.id);
	}

	private _findParallelizableSteps(steps: IPlanStep[]): string[][] {
		// Find steps that can run in parallel
		const parallelGroups: string[][] = [];
		const independentSteps = steps.filter(step => step.dependencies.length === 0);
		
		if (independentSteps.length > 1) {
			parallelGroups.push(independentSteps.map(s => s.id));
		}

		return parallelGroups;
	}

	private _findBottlenecks(steps: IPlanStep[]): string[] {
		// Find steps that many other steps depend on
		const dependencyCounts = new Map<string, number>();
		
		steps.forEach(step => {
			step.dependencies.forEach(depId => {
				dependencyCounts.set(depId, (dependencyCounts.get(depId) || 0) + 1);
			});
		});

		return Array.from(dependencyCounts.entries())
			.filter(([_, count]) => count > 2)
			.map(([stepId, _]) => stepId);
	}

	private _optimizeStepOrder(steps: IPlanStep[]): IPlanStep[] {
		// Simple topological sort for optimal ordering
		const sorted: IPlanStep[] = [];
		const visited = new Set<string>();
		const temp = new Set<string>();

		const visit = (stepId: string): void => {
			if (temp.has(stepId)) {
				return; // Circular dependency, skip
			}
			if (visited.has(stepId)) {
				return;
			}

			temp.add(stepId);
			const step = steps.find(s => s.id === stepId);
			if (step) {
				step.dependencies.forEach(depId => visit(depId));
				temp.delete(stepId);
				visited.add(stepId);
				sorted.push(step);
			}
		};

		steps.forEach(step => {
			if (!visited.has(step.id)) {
				visit(step.id);
			}
		});

		return sorted;
	}

	private _getDefaultStepDuration(stepType: StepType): number {
		// Default durations in minutes
		switch (stepType) {
			case StepType.Analysis: return 60;
			case StepType.Design: return 120;
			case StepType.Implementation: return 240;
			case StepType.Testing: return 90;
			case StepType.Review: return 45;
			case StepType.Documentation: return 60;
			case StepType.Deployment: return 30;
			case StepType.Validation: return 30;
			default: return 60;
		}
	}

	private _initializeTemplates(): void {
		this._templates = [
			{
				id: 'feature-development',
				name: 'Feature Development',
				description: 'Standard template for developing new features',
				category: TemplateCategory.Feature,
				estimatedDuration: 480, // 8 hours
				defaultConstraints: [
					{
						type: ConstraintType.Quality,
						description: 'Code must pass all tests',
						value: 'test_coverage >= 80%'
					}
				],
				steps: [
					{
						title: 'Requirements Analysis',
						description: 'Analyze and clarify feature requirements',
						type: StepType.Analysis,
						dependencies: [],
						resources: [],
						validation: {
							criteria: [{
								id: generateUuid(),
								description: 'Requirements are documented and approved',
								type: ValidationType.Documentation,
								condition: 'requirements_documented'
							}],
							automated: false,
							required: true
						}
					},
					{
						title: 'Technical Design',
						description: 'Create technical design and architecture',
						type: StepType.Design,
						dependencies: [],
						resources: [],
						validation: {
							criteria: [{
								id: generateUuid(),
								description: 'Design is reviewed and approved',
								type: ValidationType.Functionality,
								condition: 'design_approved'
							}],
							automated: false,
							required: true
						}
					},
					{
						title: 'Implementation',
						description: 'Implement the feature according to design',
						type: StepType.Implementation,
						dependencies: [],
						resources: [],
						validation: {
							criteria: [{
								id: generateUuid(),
								description: 'Code compiles and basic functionality works',
								type: ValidationType.Functionality,
								condition: 'basic_functionality_test'
							}],
							automated: true,
							required: true
						}
					},
					{
						title: 'Unit Testing',
						description: 'Create comprehensive unit tests',
						type: StepType.Testing,
						dependencies: [],
						resources: [],
						validation: {
							criteria: [{
								id: generateUuid(),
								description: 'Test coverage meets requirements',
								type: ValidationType.TestCoverage,
								condition: 'coverage >= 80%'
							}],
							automated: true,
							required: true
						}
					},
					{
						title: 'Code Review',
						description: 'Peer review of implementation and tests',
						type: StepType.Review,
						dependencies: [],
						resources: [],
						validation: {
							criteria: [{
								id: generateUuid(),
								description: 'Code review approved by peers',
								type: ValidationType.CodeQuality,
								condition: 'peer_review_approved'
							}],
							automated: false,
							required: true
						}
					},
					{
						title: 'Documentation',
						description: 'Update documentation for the new feature',
						type: StepType.Documentation,
						dependencies: [],
						resources: [],
						validation: {
							criteria: [{
								id: generateUuid(),
								description: 'Documentation is complete and accurate',
								type: ValidationType.Documentation,
								condition: 'documentation_complete'
							}],
							automated: false,
							required: true
						}
					}
				]
			}
		];
	}
}