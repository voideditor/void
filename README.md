<a name="readme-top"></a>

<div align="center">
  <h1 align="center" style="border-bottom: none">Orcide: Cloud IDE</h1>
  <p align="center"><b>Part of the Orcest AI Ecosystem</b></p>
</div>

<div align="center">
  <a href="https://github.com/orcest-ai/Orcide/blob/main/LICENSE"><img src="https://img.shields.io/badge/LICENSE-MIT-20B2AA?style=for-the-badge" alt="MIT License"></a>
</div>

<hr>

Orcide is an AI-powered cloud IDE that provides intelligent code editing, autocomplete, and refactoring capabilities. It is a core component of the **Orcest AI** ecosystem, integrated with **RainyModel** (rm.orcest.ai) for intelligent LLM routing.

### Orcest AI Ecosystem

| Service | Domain | Role |
|---------|--------|------|
| **Lamino** | llm.orcest.ai | LLM Workspace |
| **RainyModel** | rm.orcest.ai | LLM Routing Proxy |
| **Maestrist** | agent.orcest.ai | AI Agent Platform |
| **Orcide** | ide.orcest.ai | Cloud IDE |
| **Login** | login.orcest.ai | SSO Authentication |

## Features

- **AI-Powered Code Editing**: Intelligent code suggestions and completions
- **Chat Interface**: Built-in AI chat for code assistance
- **Autocomplete**: Context-aware code completion powered by RainyModel
- **Code Refactoring**: AI-assisted code improvements
- **RainyModel Integration**: Smart LLM routing with automatic fallback (Free → Internal → Premium)
- **SSO Authentication**: Enterprise-grade access control via login.orcest.ai
- **VS Code Compatible**: Full VS Code extension ecosystem support

## RainyModel Configuration

Configure Orcide to use RainyModel as its AI backend:

1. Open Settings (Ctrl+,)
2. Navigate to AI / LLM settings
3. Set:
   - **API Provider**: OpenAI-Compatible
   - **Base URL**: `https://rm.orcest.ai/v1`
   - **API Key**: Your RainyModel API key
   - **Chat Model**: `rainymodel/chat`
   - **Autocomplete Model**: `rainymodel/code`

## Development

```bash
# Install dependencies
yarn install

# Build
yarn build

# Run in development mode
yarn watch
```

## Contributing

See [HOW_TO_CONTRIBUTE.md](HOW_TO_CONTRIBUTE.md) for contribution guidelines.

## License

This project is licensed under the [MIT License](LICENSE).

Part of the [Orcest AI](https://orcest.ai) ecosystem.
