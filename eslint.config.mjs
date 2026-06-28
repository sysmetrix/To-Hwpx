import noUnsanitized from 'eslint-plugin-no-unsanitized';

// escHtml() is the project-wide sanitizer for user-controlled strings.
// Values from hardcoded source constants (FORMAT_INFO.svgIcon, FONT_DOWNLOADS paths)
// are static and not included in the allowlist — they should eventually
// use textContent or DOM methods instead of innerHTML where feasible.
const sanitizerOptions = {
    escape: {
        taggedTemplates: [],
        // Allow escHtml() calls anywhere in the expression
        methods: ['escHtml'],
    },
};

export default [
    {
        files: ['js/**/*.js'],
        plugins: {
            'no-unsanitized': noUnsanitized,
        },
        rules: {
            'no-unsanitized/property': ['warn', sanitizerOptions],
            'no-unsanitized/method': ['warn', sanitizerOptions],
        },
    },
];
