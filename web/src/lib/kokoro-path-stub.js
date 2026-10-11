// Browser stand-in. Only the Node voice-file path uses this.
export default { resolve: (...parts) => parts.join('/') }
