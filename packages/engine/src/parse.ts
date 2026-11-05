import ts from "typescript";
import type { ImportRecord, ParsedFile, RelationshipType, UnanalyzableImport } from "./types.ts";

const MAX_EXPRESSION_LENGTH = 120;

/** Reads imports and exports from syntax alone. Nothing in the file is ever executed. */
export function parseFile(path: string, content: string): ParsedFile {
  const imports: ImportRecord[] = [];
  const exports: string[] = [];
  const unanalyzable: UnanalyzableImport[] = [];

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, scriptKind(path));
  } catch {
    return { imports, exports, unanalyzable, hasSyntaxErrors: true };
  }

  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const addImport = (specifier: string, type: RelationshipType, node: ts.Node) =>
    imports.push({ specifier, type, line: lineOf(node) });

  const visitCall = (node: ts.CallExpression) => {
    const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
    if (!isImport && !isRequire) return;

    const argument = node.arguments[0];
    if (argument && ts.isStringLiteralLike(argument)) {
      addImport(argument.text, isImport ? "dynamic" : "static", node);
    } else if (argument) {
      unanalyzable.push({
        expression: node.getText(sourceFile).slice(0, MAX_EXPRESSION_LENGTH),
        line: lineOf(node),
      });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      addImport(node.moduleSpecifier.text, isTypeOnlyImport(node) ? "type" : "static", node);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      addImport(node.moduleReference.expression.text, "static", node);
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        addImport(node.moduleSpecifier.text, node.isTypeOnly ? "type" : "reexport", node);
      }
      collectExportDeclaration(node, exports);
    } else if (ts.isExportAssignment(node)) {
      if (!node.isExportEquals) exports.push("default");
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      addImport(node.argument.literal.text, "type", node);
    } else if (ts.isCallExpression(node)) {
      visitCall(node);
    }

    ts.forEachChild(node, visit);
  };

  let hasSyntaxErrors = hasParseDiagnostics(sourceFile);
  try {
    for (const statement of sourceFile.statements) {
      collectDeclaration(statement, exports);
      visit(statement);
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    hasSyntaxErrors = true; // Nesting too deep to walk. Keep what was found.
  }

  return { imports, exports: [...new Set(exports)], unanalyzable, hasSyntaxErrors };
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(path)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX; // JSX is a superset of JS and many .js files contain it.
}

function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const { parseDiagnostics } = sourceFile as unknown as { parseDiagnostics?: unknown[] };
  return (parseDiagnostics?.length ?? 0) > 0;
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  if (clause.name) return false;

  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function collectExportDeclaration(node: ts.ExportDeclaration, exports: string[]) {
  const clause = node.exportClause;
  if (!clause) return;
  if (ts.isNamedExports(clause)) {
    for (const element of clause.elements) exports.push(element.name.text);
  } else {
    exports.push(clause.name.text);
  }
}

function collectDeclaration(node: ts.Node, exports: string[]) {
  if (!ts.canHaveModifiers(node)) return;
  const modifiers = ts.getModifiers(node);
  if (!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return;

  if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
    exports.push("default");
  } else if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) exports.push(declaration.name.text);
    }
  } else if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node)) &&
    node.name &&
    ts.isIdentifier(node.name)
  ) {
    exports.push(node.name.text);
  }
}
