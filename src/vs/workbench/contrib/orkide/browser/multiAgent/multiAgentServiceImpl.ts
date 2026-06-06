/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { generateUuid } from 'vs/base/common/uuid';
import { 
	IOrkideMultiAgentService, 
	IAgent, 
	ITask, 
	ITaskResult, 
	IOrchestrationStrategy,
	AgentStatus,
	AgentSpecialization,
	TaskStatus,
	TaskType,
	TaskPriority
} from './multiAgentService';
import { IOrkideContextAwarenessService } from '../contextAwareness/contextAwarenessService';

export class OrkideMultiAgentService extends Disposable implements IOrkideMultiAgentService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeAgents = this._register(new Emitter<IAgent[]>());
	readonly onDidChangeAgents: Event<IAgent[]> = this._onDidChangeAgents.event;

	private readonly _onDidChangeTasks = this._register(new Emitter<ITask[]>());
	readonly onDidChangeTasks: Event<ITask[]> = this._onDidChangeTasks.event;

	private _agents: IAgent[] = [];
	private _tasks: ITask[] = [];
	private _orchestrationStrategy: IOrchestrationStrategy;

	constructor(
		@IOrkideContextAwarenessService private readonly contextService: IOrkideContextAwarenessService
	) {
		super();
		this._orchestrationStrategy = new DefaultOrchestrationStrategy();
		this._initializeDefaultAgents();
	}

	getAgents(): IAgent[] {
		return [...this._agents];
	}

	registerAgent(agent: IAgent) {
		this._agents.push(agent);
		this._onDidChangeAgents.fire(this._agents);
		
		return {
			dispose: () => {
				const index = this._agents.indexOf(agent);
				if (index >= 0) {
					this._agents.splice(index, 1);
					this._onDidChangeAgents.fire(this._agents);
				}
			}
		};
	}

	getTasks(): ITask[] {
		return [...this._tasks];
	}

	async executeTask(taskData: Omit<ITask, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<ITaskResult> {
		const task: ITask = {
			...taskData,
			id: generateUuid(),
			createdAt: Date.now(),
			updatedAt: Date.now(),
			status: TaskStatus.Pending
		};

		this._tasks.push(task);
		this._onDidChangeTasks.fire(this._tasks);

		try {
			// Update task status
			task.status = TaskStatus.InProgress;
			task.updatedAt = Date.now();
			this._onDidChangeTasks.fire(this._tasks);

			// Select appropriate agents
			const availableAgents = this._agents.filter(a => a.status === AgentStatus.Idle);
			const selectedAgents = this._orchestrationStrategy.selectAgents(task, availableAgents);
			
			task.assignedAgents = selectedAgents.map(a => a.id);

			// Execute task with selected agents
			const result = await this._orchestrationStrategy.coordinateExecution(task, selectedAgents);

			// Update task with result
			task.status = result.success ? TaskStatus.Completed : TaskStatus.Failed;
			task.result = result;
			task.updatedAt = Date.now();
			this._onDidChangeTasks.fire(this._tasks);

			return result;
		} catch (error) {
			task.status = TaskStatus.Failed;
			task.result = {
				success: false,
				output: `Task execution failed: ${error}`,
				errors: [String(error)]
			};
			task.updatedAt = Date.now();
			this._onDidChangeTasks.fire(this._tasks);

			return task.result;
		}
	}

	async cancelTask(taskId: string): Promise<void> {
		const task = this._tasks.find(t => t.id === taskId);
		if (task && task.status === TaskStatus.InProgress) {
			task.status = TaskStatus.Cancelled;
			task.updatedAt = Date.now();
			this._onDidChangeTasks.fire(this._tasks);
		}
	}

	getTask(taskId: string): ITask | undefined {
		return this._tasks.find(t => t.id === taskId);
	}

	setOrchestrationStrategy(strategy: IOrchestrationStrategy): void {
		this._orchestrationStrategy = strategy;
	}

	getOrchestrationStrategy(): IOrchestrationStrategy {
		return this._orchestrationStrategy;
	}

	getAgentRecommendations(task: Partial<ITask>): IAgent[] {
		if (!task.type) {
			return [];
		}

		// Simple recommendation based on task type and agent specialization
		const relevantAgents = this._agents.filter(agent => {
			switch (task.type) {
				case TaskType.CodeGeneration:
					return agent.specialization === AgentSpecialization.CodeGeneration;
				case TaskType.CodeReview:
					return agent.specialization === AgentSpecialization.CodeReview;
				case TaskType.Testing:
					return agent.specialization === AgentSpecialization.Testing;
				case TaskType.Documentation:
					return agent.specialization === AgentSpecialization.Documentation;
				case TaskType.Debugging:
					return agent.specialization === AgentSpecialization.Debugging;
				case TaskType.Refactoring:
					return agent.specialization === AgentSpecialization.Refactoring;
				default:
					return true;
			}
		});

		return relevantAgents.sort((a, b) => b.priority - a.priority);
	}

	private _initializeDefaultAgents(): void {
		const defaultAgents: IAgent[] = [
			{
				id: 'code-generator',
				name: 'Code Generator',
				description: 'Specializes in generating new code based on requirements',
				capabilities: ['code-generation', 'scaffolding', 'boilerplate'],
				status: AgentStatus.Idle,
				priority: 8,
				specialization: AgentSpecialization.CodeGeneration
			},
			{
				id: 'code-reviewer',
				name: 'Code Reviewer',
				description: 'Reviews code for quality, best practices, and potential issues',
				capabilities: ['code-review', 'quality-analysis', 'best-practices'],
				status: AgentStatus.Idle,
				priority: 7,
				specialization: AgentSpecialization.CodeReview
			},
			{
				id: 'test-engineer',
				name: 'Test Engineer',
				description: 'Creates and maintains test suites',
				capabilities: ['unit-testing', 'integration-testing', 'test-automation'],
				status: AgentStatus.Idle,
				priority: 6,
				specialization: AgentSpecialization.Testing
			},
			{
				id: 'debugger',
				name: 'Debugger',
				description: 'Identifies and fixes bugs in code',
				capabilities: ['debugging', 'error-analysis', 'performance-optimization'],
				status: AgentStatus.Idle,
				priority: 9,
				specialization: AgentSpecialization.Debugging
			},
			{
				id: 'documenter',
				name: 'Documentation Specialist',
				description: 'Creates and maintains documentation',
				capabilities: ['documentation', 'api-docs', 'user-guides'],
				status: AgentStatus.Idle,
				priority: 5,
				specialization: AgentSpecialization.Documentation
			}
		];

		defaultAgents.forEach(agent => this.registerAgent(agent));
	}
}

class DefaultOrchestrationStrategy implements IOrchestrationStrategy {
	name = 'Default Strategy';
	description = 'Basic agent selection and coordination strategy';

	selectAgents(task: ITask, availableAgents: IAgent[]): IAgent[] {
		// Simple selection based on specialization and priority
		const relevantAgents = availableAgents.filter(agent => {
			switch (task.type) {
				case TaskType.CodeGeneration:
					return agent.specialization === AgentSpecialization.CodeGeneration;
				case TaskType.CodeReview:
					return agent.specialization === AgentSpecialization.CodeReview;
				case TaskType.Testing:
					return agent.specialization === AgentSpecialization.Testing;
				case TaskType.Documentation:
					return agent.specialization === AgentSpecialization.Documentation;
				case TaskType.Debugging:
					return agent.specialization === AgentSpecialization.Debugging;
				case TaskType.Refactoring:
					return agent.specialization === AgentSpecialization.Refactoring;
				default:
					return true;
			}
		});

		// Sort by priority and return top agents
		return relevantAgents
			.sort((a, b) => b.priority - a.priority)
			.slice(0, Math.min(3, relevantAgents.length)); // Max 3 agents per task
	}

	async coordinateExecution(task: ITask, agents: IAgent[]): Promise<ITaskResult> {
		// Mark agents as working
		agents.forEach(agent => agent.status = AgentStatus.Working);

		try {
			// Simulate agent work (in real implementation, this would call actual AI services)
			await new Promise(resolve => setTimeout(resolve, 1000));

			// Simulate successful result
			const result: ITaskResult = {
				success: true,
				output: `Task "${task.description}" completed successfully by agents: ${agents.map(a => a.name).join(', ')}`,
				suggestions: [
					'Consider adding unit tests for the generated code',
					'Review the code for potential optimizations',
					'Update documentation to reflect changes'
				]
			};

			return result;
		} finally {
			// Mark agents as idle
			agents.forEach(agent => agent.status = AgentStatus.Idle);
		}
	}
}