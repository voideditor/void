/*

modelName -> {
	system_message_type: 'system' | 'developer' (openai) | null // if null, we will just do a string of system message
	supports_tools: boolean // we will just do a string of tool use if it doesn't support
	supports_autocomplete_FIM (suffix) // we will just do a description of FIM if it doens't support <|fim_hole|>

	supports_streaming: boolean (o1 does NOT)
	max_tokens: number


}

*/
