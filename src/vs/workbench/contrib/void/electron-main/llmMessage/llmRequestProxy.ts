import { setGlobalDispatcher, ProxyAgent, Agent } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';
import OpenAI, { ClientOptions } from 'openai'
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';


function getConfigValue<T>(configurationService: IConfigurationService, key: string): T | undefined {
	const values = configurationService.inspect<T>(key);
	return values.userLocalValue || values.defaultValue;
}


export const llmRequestProxy = {
	config: {
		proxyUrl: '' as string | undefined,
		strictSSL: false,
		authorization: '' as string | undefined,
	},
	proxyEnabled: false,
	newOpenAI: function (options: ClientOptions) {
		const params = {
			...options,
		}

		if (this.proxyEnabled && this.config.proxyUrl) {
			params.httpAgent = new HttpsProxyAgent(this.config.proxyUrl)
		}

		return new OpenAI(params)
	},

	configure(configurationService: IConfigurationService) {
		const proxyUrl = getConfigValue<string>(configurationService, 'http.proxy');
		const strictSSL = !!getConfigValue<boolean>(configurationService, 'http.proxyStrictSSL');
		const authorization = getConfigValue<string>(configurationService, 'http.proxyAuthorization');

		this.config.proxyUrl = proxyUrl
		this.config.strictSSL = strictSSL
		this.config.authorization = authorization
	},


	initialize(configurationService: IConfigurationService) {
		// initialize proxy config
		this.configure(configurationService)
	},

	enableProxy() {
		if (this.config.proxyUrl) {
			if (!this.proxyEnabled) {
				this.proxyEnabled = true;
				this.setCommonProxy(this.config.proxyUrl)
			}
		}
	},
	disableProxy() {
		if (this.proxyEnabled) {
			this.proxyEnabled = false;
			this.clearCommonProxy()
		}
	},

	setCommonProxy(proxyUrl: string) {
		const dispatcher = new ProxyAgent({ uri: proxyUrl });
		setGlobalDispatcher(dispatcher);
	},
	clearCommonProxy() {
		setGlobalDispatcher(new Agent());
	}
}
