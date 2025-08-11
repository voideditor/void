// Validation functions

import { ProviderSettingsSchema, SettingFieldInfo } from "./providerTypes.js";

/**
 * Validation rules for string-based settings with pattern matching and length constraints.
 */
export type SettingValidationRules = {
	/** Minimum length for string values */
	minLength?: number;
	/** Maximum length for string values */
	maxLength?: number;
	/** Regular expression pattern that value must match */
	pattern?: string;
	/** Custom validation function that returns error message if invalid, null if valid */
	custom?: (value: string) => string | null;
	/** Whether empty strings should be treated as invalid when required=true */
	noEmpty?: boolean;
};

// Number-specific validation rules
export type NumberValidationRules = {
	/** Minimum numeric value */
	min?: number;
	/** Maximum numeric value */
	max?: number;
	/** Whether the number must be an integer */
	integer?: boolean;
	/** Custom validation function for numbers */
	custom?: (value: number) => string | null;
	/** Number of decimal places allowed (for non-integers) */
	decimalPlaces?: number;
};

// Boolean-specific validation rules
export type BooleanValidationRules = {
	/** Custom validation function for booleans */
	custom?: (value: boolean) => string | null;
};

// Enum-specific validation rules
export type EnumValidationRules = {
	/** Array of allowed values */
	options: string[];
	/** Custom validation function for enum values */
	custom?: (value: string) => string | null;
};

// Multiselect-specific validation rules
export type MultiselectValidationRules = {
	/** Array of allowed values */
	options: string[];
	/** Minimum number of selections required */
	minSelections?: number;
	/** Maximum number of selections allowed */
	maxSelections?: number;
	/** Custom validation function for multiselect values */
	custom?: (values: string[]) => string | null;
};

/**
 * Union type supporting validation rules for all supported field types.
 * Provides type-safe validation configuration across different data types.
 */
export type FieldValidationRules =
	| SettingValidationRules
	| NumberValidationRules
	| BooleanValidationRules
	| EnumValidationRules
	| MultiselectValidationRules;

// Validation result for a single field
export type FieldValidationResult = {
	isValid: boolean;
	errorMessage?: string;
};

// Validation result for all settings
export type SettingsValidationResult = {
	isValid: boolean;
	fieldErrors: Record<string, string>;
};

/**
 * Validates a single field against its schema and validation rules.
 * Handles type-specific validation and required field checking.
 */
export const validateField = (
	value: string | undefined,
	fieldInfo: SettingFieldInfo,
	fieldName: string
): FieldValidationResult => {
	const { isRequired, fieldType = "string", validation } = fieldInfo;

	if (isRequired && (!value || value.trim() === "")) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} is required`,
		};
	}

	if (!value && !isRequired) {
		return { isValid: true };
	}

	if (!validation) {
		return { isValid: true };
	}

	const trimmedValue = value || "";

	if (fieldType === "number") {
		return validateNumberField(
			trimmedValue,
			validation as NumberValidationRules,
			fieldInfo
		);
	}

	if (fieldType === "boolean") {
		return validateBooleanField(
			trimmedValue,
			validation as BooleanValidationRules,
			fieldInfo
		);
	}

	if (fieldType === "enum") {
		return validateEnumField(
			trimmedValue,
			validation as EnumValidationRules,
			fieldInfo
		);
	}

	if (fieldType === "multiselect") {
		return validateMultiselectField(
			trimmedValue,
			validation as MultiselectValidationRules,
			fieldInfo
		);
	}

	return validateStringField(
		trimmedValue,
		validation as SettingValidationRules,
		fieldInfo
	);
};

/**
 * Validates a string field against string validation rules
 */
const validateStringField = (
	value: string,
	validation: SettingValidationRules,
	fieldInfo: SettingFieldInfo
): FieldValidationResult => {
	if (
		validation.minLength !== undefined &&
		value.length < validation.minLength
	) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be at least ${validation.minLength} characters long`,
		};
	}

	if (
		validation.maxLength !== undefined &&
		value.length > validation.maxLength
	) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be no more than ${validation.maxLength} characters long`,
		};
	}

	if (validation.pattern && value) {
		try {
			const regex = new RegExp(validation.pattern);
			if (!regex.test(value)) {
				return {
					isValid: false,
					errorMessage: `${fieldInfo.title} has an invalid format`,
				};
			}
		} catch (e) {
			return {
				isValid: false,
				errorMessage: `${fieldInfo.title} validation pattern is invalid`,
			};
		}
	}

	if (validation.custom && value) {
		const customError = validation.custom(value);
		if (customError) {
			return {
				isValid: false,
				errorMessage: customError,
			};
		}
	}

	return { isValid: true };
};

/**
 * Validates numeric fields with range, integer, and decimal precision constraints.
 */
const validateNumberField = (
	value: string,
	validation: NumberValidationRules,
	fieldInfo: SettingFieldInfo
): FieldValidationResult => {
	const numValue = parseFloat(value);
	if (isNaN(numValue)) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be a valid number`,
		};
	}

	if (validation.integer && !Number.isInteger(numValue)) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be an integer`,
		};
	}

	if (validation.decimalPlaces !== undefined && !validation.integer) {
		const decimalPart = value.split(".")[1];
		if (decimalPart && decimalPart.length > validation.decimalPlaces) {
			return {
				isValid: false,
				errorMessage: `${fieldInfo.title} can have at most ${validation.decimalPlaces} decimal places`,
			};
		}
	}

	if (validation.min !== undefined && numValue < validation.min) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be at least ${validation.min}`,
		};
	}

	if (validation.max !== undefined && numValue > validation.max) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be no more than ${validation.max}`,
		};
	}

	if (validation.custom) {
		const customError = validation.custom(numValue);
		if (customError) {
			return {
				isValid: false,
				errorMessage: customError,
			};
		}
	}

	return { isValid: true };
};

/**
 * Validates a boolean field against boolean validation rules
 */
const validateBooleanField = (
	value: string,
	validation: BooleanValidationRules,
	fieldInfo: SettingFieldInfo
): FieldValidationResult => {
	if (value !== "true" && value !== "false") {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be true or false`,
		};
	}

	const boolValue = value === "true";

	if (validation.custom) {
		const customError = validation.custom(boolValue);
		if (customError) {
			return {
				isValid: false,
				errorMessage: customError,
			};
		}
	}

	return { isValid: true };
};

/**
 * Validates an enum field against enum validation rules
 */
const validateEnumField = (
	value: string,
	validation: EnumValidationRules,
	fieldInfo: SettingFieldInfo
): FieldValidationResult => {
	if (!validation.options.includes(value)) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title
				} must be one of: ${validation.options.join(", ")}`,
		};
	}

	if (validation.custom) {
		const customError = validation.custom(value);
		if (customError) {
			return {
				isValid: false,
				errorMessage: customError,
			};
		}
	}

	return { isValid: true };
};

/**
 * Validates multiselect fields that contain comma-separated values.
 * Ensures all selections are valid options and respects min/max selection limits.
 */
const validateMultiselectField = (
	value: string,
	validation: MultiselectValidationRules,
	fieldInfo: SettingFieldInfo
): FieldValidationResult => {
	let values: string[] = [];
	if (value.trim()) {
		values = value
			.split(",")
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
	}

	const invalidOptions = values.filter((v) => !validation.options.includes(v));
	if (invalidOptions.length > 0) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title
				} contains invalid options: ${invalidOptions.join(
					", "
				)}. Allowed options: ${validation.options.join(", ")}`,
		};
	}

	if (
		validation.minSelections !== undefined &&
		values.length < validation.minSelections
	) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must have at least ${validation.minSelections
				} selection${validation.minSelections === 1 ? "" : "s"}`,
		};
	}

	if (
		validation.maxSelections !== undefined &&
		values.length > validation.maxSelections
	) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must have no more than ${validation.maxSelections
				} selection${validation.maxSelections === 1 ? "" : "s"}`,
		};
	}

	if (validation.custom) {
		const customError = validation.custom(values);
		if (customError) {
			return {
				isValid: false,
				errorMessage: customError,
			};
		}
	}

	return { isValid: true };
};

/**
 * Validates all provider settings against their schema definitions.
 * Returns comprehensive validation results with field-specific error messages.
 */
export const validateProviderSettings = (
	settings: Record<string, string>,
	schema: ProviderSettingsSchema
): SettingsValidationResult => {
	const fieldErrors: Record<string, string> = {};
	let isValid = true;

	for (const [fieldName, fieldInfo] of Object.entries(schema)) {
		const fieldValue = settings[fieldName];
		const result = validateField(fieldValue, fieldInfo, fieldName);

		if (!result.isValid && result.errorMessage) {
			fieldErrors[fieldName] = result.errorMessage;
			isValid = false;
		}
	}

	return {
		isValid,
		fieldErrors,
	};
};
