declare module 'highlight.js' {
    const hljs: any;
    export = hljs;
}

declare module 'highlight.js/lib/core' {
    const hljs: any;
    export default hljs;
}

declare module 'highlight.js/lib/languages/*' {
    const lang: any;
    export default lang;
}
