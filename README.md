# Archemist Component Generator

Generate a component — main file, style, test — for **React, Vue, Svelte, or Angular**, matching whatever stack, style library, and conventions your project already uses.

## Usage

- Right-click a folder in the Explorer → **Generate Component**
- Or Command Palette (`Ctrl+Shift+P`) → **Component Generator: Generate Component**
- Pick a component type (Blank, Button, Modal, Form, List), enter a name (any casing is converted to PascalCase)

### Generate from a selection

Select some JSX/markup (e.g. `<div>{title}</div>`) or a JSON sample (e.g. an API response) in the editor, right-click → **Generate Component from Selection**. The selected identifiers/keys become the generated component's props, with their types inferred where possible.

## How stack detection works

The extension walks up from the target folder to the nearest `package.json` and looks at its dependencies:

| Dependency | Stack |
|---|---|
| `@angular/core` | Angular |
| `vue` | Vue |
| `svelte` | Svelte |
| `react` | React |

No match (or no `package.json`) → you're prompted to pick one manually. Force a specific stack with `componentGenerator.stack`.

## How style library detection works

Same idea, applied to styling: `tailwindcss`, `styled-components`, `@emotion/styled`/`@emotion/react`, `@chakra-ui/react`, or `@mui/material` in dependencies switches the generated component to that library's idioms (e.g. a `button` type generates a Chakra/MUI `<Button>` instead of a native `<button>` + CSS module). Force it with `componentGenerator.styleLib`.

## Repo convention detection

Before generating, the extension looks at up to 8 sibling component folders already in the target directory and infers file naming (`index.tsx` vs `ComponentName.tsx`), export style (named vs default), style format, and test framework from what's actually there — overriding the global settings below when a clear pattern is found.

## Barrel file updates

If the target folder already has an `index.ts` re-exporting its components, the new component's export is appended to it automatically (skipped if it's not present — nothing is created from scratch).

## Component types

`Blank` (children/slot only), `Button`, `Modal`, `Form`, `List` — each ported to the idiomatic pattern of the detected stack (e.g. a `onClick` prop becomes a Vue `defineEmits`/Angular `output()` event rather than a raw callback prop).

### Custom fields for Form and List

Picking `Form` or `List` opens an interactive field table: select **+ Add field…** to name a field and pick its type (text, email, password, number, textarea, checkbox, date), select an already-added field to remove it, select **Done** to confirm. Selecting Done with no fields added falls back to the default single "email" field (Form) or `string[]` (List) — nothing changes if you just want the quick default.

With fields, a Form's submit callback bundles them into one object (`onSubmit: (values: { name: string; email: string }) => void`) and a List's items become an object shape (`items: { title: string; price: number }[]`) instead of `string[]`, rendered per field in each stack's idiom.

## Settings

| Setting | Default | Description |
|---|---|---|
| `componentGenerator.stack` | `auto` | `auto`, `react`, `vue`, `svelte`, or `angular` |
| `componentGenerator.styleLib` | `auto` | `auto`, `plain`, `tailwind`, `styled-components`, `emotion`, `chakra-ui`, or `mui` |
| `componentGenerator.styleFormat` | `css-module` | `css-module`, `scss-module`, `css`, `scss`, or `none` |
| `componentGenerator.generateTest` | `true` | Generate a test file |
| `componentGenerator.testFramework` | `jest` | `jest` or `vitest` imports in the test file |
| `componentGenerator.fileNaming` | `index` | `index` or `componentName` (ignored by Angular, which always uses kebab-case) |
| `componentGenerator.exportStyle` | `named` | `named` or `default` (React only) |

## CLI

The same generation logic is available outside VS Code:

```
npx generate-component <name> [targetDir] [options]

  --stack=react|vue|svelte|angular|auto
  --type=blank|button|modal|form|list
  --fields=name:kind,name:kind (form/list only; kinds: text|email|password|number|textarea|checkbox|date)
  --style-lib=auto|plain|tailwind|styled-components|emotion|chakra-ui|mui
  --style-format=css-module|scss-module|css|scss|none
  --file-naming=index|componentName
  --export-style=named|default
  --test-framework=jest|vitest
  --no-test
```

## Development

```
npm install
npm run watch
```

Press `F5` in VS Code (with this folder open as the workspace root) to launch an Extension Development Host with the extension loaded.

## Testing

```
npm test
```

Runs real integration tests in an actual VS Code instance (`@vscode/test-electron`) — the command is executed end-to-end and the generated files are asserted on disk, not mocked.

## Packaging & Publishing

```
npm run compile
npx vsce package
npx vsce publish
npx ovsx publish -p <open-vsx-token>
```
