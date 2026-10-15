// Applied only to the fixed web-retrieval MCP subprocesses, never model endpoints.
if (process.env.WEB_TOOLS_PROXY_URL) {
    const { ProxyAgent, setGlobalDispatcher } = require('undici')
    setGlobalDispatcher(new ProxyAgent(process.env.WEB_TOOLS_PROXY_URL))
}
