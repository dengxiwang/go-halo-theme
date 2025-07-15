/** @type {import('tailwindcss').Config} */
import { addDynamicIconSelectors } from '@iconify/tailwind/dist/plugin';
module.exports = {
    content: ["./templates/**/*.html", "./src/main.ts"],
    theme: {
        extend: {},
    },
    plugins: [
        require("@tailwindcss/typography"),
        addDynamicIconSelectors(),
    ],
    safelist: [
        "prose-sm",
        "prose-base",
        "prose-lg",
        "prose-xl",
        "prose-2xl",
        "prose-gray",
        "prose-slate",
        "prose-zinc",
        "prose-neutral",
        "prose-stone",
    ],
};
