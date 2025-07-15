/** @type {Promise<import("prettier").PluginWithOptions>} */
const pluginTailwind = import("prettier-plugin-tailwindcss");

export default {
    plugins: [pluginTailwind],
    printWidth: 120,
    tabWidth: 2,
    useTabs: false,
    endOfLine: "lf",
};