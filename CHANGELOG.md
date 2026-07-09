# Change Log

All notable changes to the "component" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Initial release
- Multi-stack support: React, Vue, Svelte, Angular, auto-detected from `package.json`
- Style library detection (Tailwind, styled-components, Emotion, Chakra UI, MUI)
- Component types: Blank, Button, Modal, Form, List, ported to each stack's idioms
- Repo convention detection from sibling components (file naming, export style, style format, test framework)
- Automatic barrel file (`index.ts`) updates
- Generate a component from a code/JSON selection, inferring props
- Standalone CLI (`npx generate-component`) reusing the same generation core
- Custom fields for Form/List via an interactive field table (VS Code) or `--fields=name:kind,...` (CLI), falling back to the previous single-email/`string[]` defaults when none are added