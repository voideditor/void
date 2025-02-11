/*

modelName -> {
	system_message_type: 'system' | 'developer' (openai) | null // if null, we will just do a string of system message
	supports_tools: boolean // we will just do a string of tool use if it doesn't support
	supports_autocomplete_FIM (suffix) // we will just do a description of FIM if it doens't support <|fim_hole|>

	supports_streaming: boolean // (o1 does NOT) we will just dump the final result if doesn't support it
	max_tokens: number // required, DEFAULT is Infinity

}

*/
