import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'tmp/'] },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
  },
  stylistic.configs.recommended,
  { rules: { '@stylistic/semi': ['error', 'always'] } },
);
