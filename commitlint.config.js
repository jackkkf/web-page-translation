export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 与 docs/engineering/ai-workflow.md 里约定的 scope 保持一致
    'scope-enum': [
      2,
      'always',
      ['core', 'engines', 'content', 'background', 'ui', 'build', 'docs', 'test', 'ci', 'deps', 'store', 'release'],
    ],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
};
