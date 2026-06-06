/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';

export const IOrkideMultiAgentService = createDecorator<IOrkideMultiAgentService>('orkideMultiAgentService');

export interface IAgent {
	id: string;
	name: string;
	description: string;
	capabilities: string[];
	status: AgentStatus;
	priority: number;
	specialization: AgentSpecialization;
}

export enum AgentStatus {
	Idle = 'idle',
	Working = 'working',
	Waiting = 'waiting',
	Error = 'error',
	Offline = 'offline'
}

export enum AgentSpecialization {
	CodeGeneration = 'codeGeneration',
	CodeReview = 'codeReview',
	Testing = 'testing',
	Documentation = 'documentation',
	Debugging = 'debugging',
	Refactoring = 'refactoring',
	Architecture = 'architecture',
	Security = 'security'
}

export interface ITask {
	id: string;
	description: string;
	type: TaskType;
	priority: TaskPriority;
	context: ITaskContext;
	assignedAgents: string[];
	status: TaskStatus;
	createdAt: number;
	updatedAt: number;
	result?: ITaskResult;
	dependencies: string[];
}

export enum TaskType {
	CodeGeneration = 'codeGeneration',
	CodeReview = 'codeReview',
	Testing = 'testing',
	Documentation = 'documentation',
	Debugging = 'debugging',
	Refactoring = 'refactoring',
	Analysis = 'analysis'
}

export enum TaskPriority {
	Low = 1,
	Medium = 2,
	High = 3,
	Critical = 4
}

export enum TaskStatus {
	Pending = 'pending',
	InProgress = 'inProgress',
	Completed = 'completed',
	Failed = 'failed',
	Cancelled = 'cancelled'
}

export interface ITaskContext {
	files: URI[];
	selectedText?: string;
	cursorPosition?: { line: number; column: number };
	userPrompt: string;
	additionalContext?: any;
}

export interface ITaskResult {
	success: boolean;
	output: string;
	files?: IFileChange[];
	suggestions?: string[];
	errors?: string[];
	metadata?: any;
}

export interface IFileChange {
	uri: URI;
	action: 'create' | 'modify' | 'delete';
	content?: string;
	changes?: ITextChange[];
}

export interface ITextChange {
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	newText: string;
}

export interface IOrchestrationStrategy {
	name: string;
	description: string;
	selectAgents(task: ITask, availableAgents: IAgent[]): IAgent[];
	coordinateExecution(task: ITask, agents: IAgent[]): Promise<ITaskResult>;
}

export interface IOrkideMultiAgentService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when agents change
	 */
	readonly onDidChangeAgents: Event<IAgent[]>;

	/**
	 * Event fired when tasks change
	 */
	readonly onDidChangeTasks: Event<ITask[]>;

	/**
	 * Get all available agents
	 */
	getAgents(): IAgent[];

	/**
	 * Register a new agent
	 */
	registerAgent(agent: IAgent): IDisposable;

	/**
	 * Get all tasks
	 */
	getTasks(): ITask[];

	/**
	 * Create and execute a new task
	 */
	executeTask(task: Omit<ITask, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<ITaskResult>;

	/**
	 * Cancel a task
	 */
	cancelTask(taskId: string): Promise<void>;

	/**
	 * Get task by ID
	 */
	getTask(taskId: string): ITask | undefined;

	/**
	 * Set orchestration strategy
	 */
	setOrchestrationStrategy(strategy: IOrchestrationStrategy): void;

	/**
	 * Get current orchestration strategy
	 */
	getOrchestrationStrategy(): IOrchestrationStrategy;

	/**
	 * Get agent recommendations for a task
	 */
	getAgentRecommendations(task: Partial<ITask>): IAgent[];
}