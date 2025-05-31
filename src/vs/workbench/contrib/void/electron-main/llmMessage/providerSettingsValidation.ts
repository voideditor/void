// Validation functions

import { ProviderSettingsSchema, SettingFieldInfo } from "./providerTypes.js";

// Validation rules for settings (JSON Schema-like but limited)
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

// Combined validation rules that can handle all field types
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
 * Validates a single field value against its validation rules
 */
export const validateField = (
	value: string | undefined,
	fieldInfo: SettingFieldInfo,
	fieldName: string
): FieldValidationResult => {
	const { isRequired, fieldType = "string", validation } = fieldInfo;

	// Check if field is required
	if (isRequired && (!value || value.trim() === "")) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} is required`,
		};
	}

	// If no value and not required, it's valid
	if (!value && !isRequired) {
		return { isValid: true };
	}

	// If no validation rules, it's valid
	if (!validation) {
		return { isValid: true };
	}

	const trimmedValue = value || "";

	// Handle number field validation
	if (fieldType === "number") {
		return validateNumberField(
			trimmedValue,
			validation as NumberValidationRules,
			fieldInfo
		);
	}

	// Handle boolean field validation
	if (fieldType === "boolean") {
		return validateBooleanField(
			trimmedValue,
			validation as BooleanValidationRules,
			fieldInfo
		);
	}

	// Handle enum field validation
	if (fieldType === "enum") {
		return validateEnumField(
			trimmedValue,
			validation as EnumValidationRules,
			fieldInfo
		);
	}

	// Handle multiselect field validation
	if (fieldType === "multiselect") {
		return validateMultiselectField(
			trimmedValue,
			validation as MultiselectValidationRules,
			fieldInfo
		);
	}

	// Handle string field validation
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
	// Check minimum length
	if (
		validation.minLength !== undefined &&
		value.length < validation.minLength
	) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be at least ${validation.minLength} characters long`,
		};
	}

	// Check maximum length
	if (
		validation.maxLength !== undefined &&
		value.length > validation.maxLength
	) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be no more than ${validation.maxLength} characters long`,
		};
	}

	// Check pattern
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

	// Check custom validation
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
 * Validates a number field against number validation rules
 */
const validateNumberField = (
	value: string,
	validation: NumberValidationRules,
	fieldInfo: SettingFieldInfo
): FieldValidationResult => {
	// Parse the number
	const numValue = parseFloat(value);
	if (isNaN(numValue)) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be a valid number`,
		};
	}

	// Check if integer is required
	if (validation.integer && !Number.isInteger(numValue)) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be an integer`,
		};
	}

	// Check decimal places
	if (validation.decimalPlaces !== undefined && !validation.integer) {
		const decimalPart = value.split(".")[1];
		if (decimalPart && decimalPart.length > validation.decimalPlaces) {
			return {
				isValid: false,
				errorMessage: `${fieldInfo.title} can have at most ${validation.decimalPlaces} decimal places`,
			};
		}
	}

	// Check minimum value
	if (validation.min !== undefined && numValue < validation.min) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be at least ${validation.min}`,
		};
	}

	// Check maximum value
	if (validation.max !== undefined && numValue > validation.max) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be no more than ${validation.max}`,
		};
	}

	// Check custom validation
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
	// Check if value is a valid boolean representation
	if (value !== "true" && value !== "false") {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title} must be true or false`,
		};
	}

	// Parse the boolean
	const boolValue = value === "true";

	// Check custom validation
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
	// Check if value is in allowed options
	if (!validation.options.includes(value)) {
		return {
			isValid: false,
			errorMessage: `${fieldInfo.title
				} must be one of: ${validation.options.join(", ")}`,
		};
	}

	// Check custom validation
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
 * Validates a multiselect field against multiselect validation rules
 */
const validateMultiselectField = (
	value: string,
	validation: MultiselectValidationRules,
	fieldInfo: SettingFieldInfo
): FieldValidationResult => {
	// Parse comma-separated values
	let values: string[] = [];
	if (value.trim()) {
		values = value
			.split(",")
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
	}

	// Check for invalid options
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

	// Check minimum selections
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

	// Check maximum selections
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

	// Check custom validation
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
 * Validates an entire settings object against a provider settings schema
 */
export const validateProviderSettings = (
	settings: Record<string, string>,
	schema: ProviderSettingsSchema
): SettingsValidationResult => {
	const fieldErrors: Record<string, string> = {};
	let isValid = true;

	// Validate each field in the schema
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
