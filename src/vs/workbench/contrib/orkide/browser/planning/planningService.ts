/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';

export const IOrkidePlanningService = createDecorator<IOrkidePlanningService>('orkidePlanningService');

export interface IPlan {
	id: string;
	title: string;
	description: string;
	objective: string;
	status: PlanStatus;
	priority: PlanPriority;
	createdAt: number;
	updatedAt: number;
	estimatedDuration?: number;
	actualDuration?: number;
	steps: IPlanStep[];
	dependencies: string[];
	tags: string[];
	context: IPlanContext;
	metadata: IPlanMetadata;
}

export enum PlanStatus {
	Draft = 'draft',
	Active = 'active',
	InProgress = 'inProgress',
	Completed = 'completed',
	Cancelled = 'cancelled',
	OnHold = 'onHold'
}

export enum PlanPriority {
	Low = 1,
	Medium = 2,
	High = 3,
	Critical = 4
}

export interface IPlanStep {
	id: string;
	title: string;
	description: string;
	type: StepType;
	status: StepStatus;
	estimatedDuration?: number;
	actualDuration?: number;
	dependencies: string[];
	assignedAgent?: string;
	resources: IStepResource[];
	validation: IStepValidation;
	output?: IStepOutput;
	createdAt: number;
	updatedAt: number;
}

export enum StepType {
	Analysis = 'analysis',
	Design = 'design',
	Implementation = 'implementation',
	Testing = 'testing',
	Review = 'review',
	Documentation = 'documentation',
	Deployment = 'deployment',
	Validation = 'validation'
}

export enum StepStatus {
	Pending = 'pending',
	InProgress = 'inProgress',
	Completed = 'completed',
	Failed = 'failed',
	Skipped = 'skipped',
	Blocked = 'blocked'
}

export interface IStepResource {
	type: ResourceType;
	uri?: URI;
	content?: string;
	metadata?: any;
}

export enum ResourceType {
	File = 'file',
	Directory = 'directory',
	Documentation = 'documentation',
	API = 'api',
	Tool = 'tool',
	Reference = 'reference'
}

export interface IStepValidation {
	criteria: IValidationCriteria[];
	automated: boolean;
	required: boolean;
}

export interface IValidationCriteria {
	id: string;
	description: string;
	type: ValidationType;
	condition: string;
	passed?: boolean;
	message?: string;
}

export enum ValidationType {
	CodeQuality = 'codeQuality',
	TestCoverage = 'testCoverage',
	Performance = 'performance',
	Security = 'security',
	Functionality = 'functionality',
	Documentation = 'documentation'
}

export interface IStepOutput {
	type: OutputType;
	content: string;
	files?: IFileOutput[];
	metadata?: any;
}

export enum OutputType {
	Code = 'code',
	Documentation = 'documentation',
	Test = 'test',
	Configuration = 'configuration',
	Report = 'report',
	Analysis = 'analysis'
}

export interface IFileOutput {
	uri: URI;
	action: FileAction;
	content?: string;
	changes?: ITextChange[];
}

export enum FileAction {
	Create = 'create',
	Modify = 'modify',
	Delete = 'delete',
	Move = 'move',
	Copy = 'copy'
}

export interface ITextChange {
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	newText: string;
}

export interface IPlanContext {
	workspaceRoot?: URI;
	targetFiles: URI[];
	userRequirements: string;
	constraints: IConstraint[];
	assumptions: string[];
	risks: IRisk[];
}

export interface IConstraint {
	type: ConstraintType;
	description: string;
	value?: any;
}

export enum ConstraintType {
	Time = 'time',
	Budget = 'budget',
	Technology = 'technology',
	Quality = 'quality',
	Scope = 'scope',
	Resource = 'resource'
}

export interface IRisk {
	id: string;
	description: string;
	probability: RiskProbability;
	impact: RiskImpact;
	mitigation: string;
	status: RiskStatus;
}

export enum RiskProbability {
	Low = 1,
	Medium = 2,
	High = 3
}

export enum RiskImpact {
	Low = 1,
	Medium = 2,
	High = 3
}

export enum RiskStatus {
	Identified = 'identified',
	Mitigated = 'mitigated',
	Accepted = 'accepted',
	Occurred = 'occurred'
}

export interface IPlanMetadata {
	version: number;
	author?: string;
	reviewers: string[];
	approvers: string[];
	lastReviewed?: number;
	approved?: boolean;
	approvedAt?: number;
	approvedBy?: string;
}

export interface IPlanTemplate {
	id: string;
	name: string;
	description: string;
	category: TemplateCategory;
	steps: Omit<IPlanStep, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'output'>[];
	defaultConstraints: IConstraint[];
	estimatedDuration: number;
}

export enum TemplateCategory {
	Feature = 'feature',
	Bugfix = 'bugfix',
	Refactoring = 'refactoring',
	Testing = 'testing',
	Documentation = 'documentation',
	Deployment = 'deployment',
	Migration = 'migration',
	Custom = 'custom'
}

export interface IPlanExecution {
	planId: string;
	currentStepId?: string;
	startedAt?: number;
	completedAt?: number;
	pausedAt?: number;
	progress: IExecutionProgress;
	logs: IExecutionLog[];
}

export interface IExecutionProgress {
	totalSteps: number;
	completedSteps: number;
	failedSteps: number;
	skippedSteps: number;
	percentage: number;
	estimatedTimeRemaining?: number;
}

export interface IExecutionLog {
	timestamp: number;
	level: LogLevel;
	stepId?: string;
	message: string;
	details?: any;
}

export enum LogLevel {
	Debug = 'debug',
	Info = 'info',
	Warning = 'warning',
	Error = 'error'
}

export interface IOrkidePlanningService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when plans change
	 */
	readonly onDidChangePlans: Event<IPlan[]>;

	/**
	 * Event fired when plan execution status changes
	 */
	readonly onDidChangeExecution: Event<IPlanExecution>;

	/**
	 * Get all plans
	 */
	getPlans(): IPlan[];

	/**
	 * Get plan by ID
	 */
	getPlan(id: string): IPlan | undefined;

	/**
	 * Create a new plan
	 */
	createPlan(plan: Omit<IPlan, 'id' | 'createdAt' | 'updatedAt'>): Promise<IPlan>;

	/**
	 * Update an existing plan
	 */
	updatePlan(id: string, updates: Partial<IPlan>): Promise<IPlan>;

	/**
	 * Delete a plan
	 */
	deletePlan(id: string): Promise<void>;

	/**
	 * Generate a plan from user requirements
	 */
	generatePlan(requirements: string, context?: Partial<IPlanContext>): Promise<IPlan>;

	/**
	 * Get available plan templates
	 */
	getTemplates(): IPlanTemplate[];

	/**
	 * Create plan from template
	 */
	createPlanFromTemplate(templateId: string, customization?: Partial<IPlan>): Promise<IPlan>;

	/**
	 * Execute a plan
	 */
	executePlan(planId: string): Promise<IPlanExecution>;

	/**
	 * Pause plan execution
	 */
	pauseExecution(planId: string): Promise<void>;

	/**
	 * Resume plan execution
	 */
	resumeExecution(planId: string): Promise<void>;

	/**
	 * Cancel plan execution
	 */
	cancelExecution(planId: string): Promise<void>;

	/**
	 * Get execution status
	 */
	getExecution(planId: string): IPlanExecution | undefined;

	/**
	 * Validate a plan
	 */
	validatePlan(plan: IPlan): Promise<IValidationResult>;

	/**
	 * Estimate plan duration
	 */
	estimateDuration(plan: IPlan): Promise<number>;

	/**
	 * Get plan dependencies
	 */
	analyzeDependencies(plan: IPlan): Promise<IDependencyAnalysis>;

	/**
	 * Optimize plan execution order
	 */
	optimizePlan(plan: IPlan): Promise<IPlan>;
}

export interface IValidationResult {
	valid: boolean;
	errors: IValidationError[];
	warnings: IValidationWarning[];
	suggestions: string[];
}

export interface IValidationError {
	stepId?: string;
	message: string;
	severity: 'error' | 'warning';
	code: string;
}

export interface IValidationWarning {
	stepId?: string;
	message: string;
	code: string;
}

export interface IDependencyAnalysis {
	cycles: string[][];
	criticalPath: string[];
	parallelizable: string[][];
	bottlenecks: string[];
}