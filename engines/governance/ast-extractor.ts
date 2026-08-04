/**
 * AST-based literal extractor (HCG Phase 2.8, Scanner Context Coverage).
 * registry/CURRENT_STATE.json plan_lock.exceptions_log -> HCG.
 *
 * Replaces the regex-based CANDIDATE_RE walk for .ts/.tsx files. Uses the
 * TypeScript compiler API (`typescript`, already a repo devDependency for
 * tsc itself — no new package added, per the phase's own "use an existing
 * AST parser if one exists" instruction).
 *
 * Real gap this closes (confirmed live during coverage probing): the regex
 * extractor scanned raw text line-by-line, so a single large multi-line
 * template-literal string (e.g. an AI system prompt containing embedded
 * JSON-shaped example text like `payload: {name:"ชื่อ"}`) got torn apart
 * into dozens of spurious "candidate" sub-matches — fragments of prompt
 * COPY, not real code assignments. An AST walk sees that whole span as one
 * NoSubstitutionTemplateLiteral node and never looks inside its .text for
 * further matches, which structurally cannot happen with a real parser.
 *
 * Also closes real, previously-invisible extraction gaps: function
 * arguments (positional, no identifier), array elements, return values,
 * conditional/comparison expressions, import/export module specifiers,
 * decorator arguments — none of these match `identifier [:=] "value"`
 * shape, so the old regex extractor never saw them at all.
 */
import * as ts from "typescript";

export interface ASTLiteralHit {
  value: string;
  file: string;
  line: number;
  column: number;
  /**
   * Computed via ts.isNumericLiteral(node) at extraction time — NOT derived
   * from ast_node_type by string name. Found live (HCG Phase 2.8): TypeScript's
   * ts.SyntaxKind reverse-lookup (ts.SyntaxKind[node.kind]) returns the alias
   * "FirstLiteralToken" for numeric literals, not "NumericLiteral" — a string
   * comparison against "NumericLiteral" silently always failed, which would
   * have let every numeric literal in the codebase bypass the
   * NUMERIC_SUSPICIOUS_KEY_RE noise filter entirely (confirmed: `backoff_ms:
   * 500` was caught unguarded and misclassified as HTTP status 500, since
   * nothing was filtering it by context first).
   */
  is_numeric: boolean;
  identifier_name: string | null;
  property_name: string | null;
  parent_function: string | null;
  call_target: string | null;
  arg_position: number | null;
  ast_node_type: string;
  is_import_export: boolean;
  file_category: "test" | "config" | "registry" | "runtime";
  usage_context: string;
  /** Best-available name to feed classify()'s context_key — identifier, property, param, compared-against key, or "" if none found. */
  context_key: string;
}

function fileCategoryOf(filePath: string): ASTLiteralHit["file_category"] {
  if (/\.(test|spec)\.tsx?$/.test(filePath) || /__tests__|__fixtures__|\/fixtures\//.test(filePath)) return "test";
  if (/\/config\//.test(filePath) || /\.config\.tsx?$/.test(filePath)) return "config";
  if (/(^|\/)registry\//.test(filePath)) return "registry";
  return "runtime";
}

/** Nearest enclosing function-ish name, if any (FunctionDeclaration, MethodDeclaration, or a const-assigned arrow/function expression). */
function findParentFunctionName(node: ts.Node): string | null {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) && cur.parent && ts.isVariableDeclaration(cur.parent) && ts.isIdentifier(cur.parent.name)) {
      return cur.parent.name.text;
    }
    cur = cur.parent;
  }
  return null;
}

/** Nearest enclosing CallExpression where this node (or its direct template-expression wrapper) is one of the arguments — not the callee. */
function findCallContext(node: ts.Node): { target: string; argPosition: number } | null {
  let target: ts.Node = node;
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isCallExpression(cur)) {
      const idx = cur.arguments.findIndex((a) => a === target);
      if (idx >= 0) {
        return { target: cur.expression.getText().replace(/\s+/g, ""), argPosition: idx };
      }
    }
    // Stop walking up once we leave a simple wrapper chain (property access on the literal itself doesn't apply here).
    if (ts.isPropertyAssignment(cur) || ts.isVariableDeclaration(cur) || ts.isBlock(cur) || ts.isSourceFile(cur)) break;
    target = cur;
    cur = cur.parent;
  }
  return null;
}

function isInsideImportExport(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (ts.isImportDeclaration(cur) || ts.isExportDeclaration(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

/** Comparison target name for `identifier === "VALUE"` / `"VALUE" === identifier` shaped expressions. */
const JS_TYPEOF_RESULTS = new Set(["string", "number", "boolean", "undefined", "object", "function", "bigint", "symbol"]);

/**
 * True if this literal is the right-hand operand of a `typeof x === "..."`
 * (or `!==`/`==`/`!=`) type-guard comparison. Found live during HCG Phase 2.8
 * scanning of the real repo: `typeof body?.box_password === "string"` was
 * caught by the new comparison-expression coverage, and its comparison-key
 * text ("typeof body?.box_password") happened to contain the substring
 * "password" — triggering FHP-PASSWORD-LITERAL as a false SECURITY_VIOLATION
 * on the literal "string", which is not a business/secret value at all, it's
 * one of ECMAScript's own 8 fixed `typeof` result strings. Excluded from
 * extraction entirely (not even worth classifying) rather than patched at
 * the classify() layer, since this is a structural JS-language fact, not a
 * hardcode-governance judgment call.
 */
function isTypeofComparisonOperand(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent || !ts.isBinaryExpression(parent)) return false;
  const op = parent.operatorToken.kind;
  const isEquality =
    op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    op === ts.SyntaxKind.EqualsEqualsToken ||
    op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    op === ts.SyntaxKind.ExclamationEqualsToken;
  if (!isEquality) return false;
  const other = parent.left === node ? parent.right : parent.left;
  return ts.isTypeOfExpression(other) && ts.isStringLiteral(node) && JS_TYPEOF_RESULTS.has(node.text);
}

function findComparisonKey(node: ts.Node): string | null {
  const parent = node.parent;
  if (parent && ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) {
      const other = parent.left === node ? parent.right : parent.left;
      return other.getText().replace(/\s+/g, "");
    }
  }
  return null;
}

export function extractLiteralsAST(sourceText: string, filePath: string): ASTLiteralHit[] {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const hits: ASTLiteralHit[] = [];
  const fileCategory = fileCategoryOf(filePath);

  function posOf(node: ts.Node) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { line: line + 1, column: character + 1 };
  }

  function visit(node: ts.Node) {
    // Template expressions (has interpolation): capture the whole raw text as
    // ONE value (matches prior behavior for "detect a fully-static template"
    // vs "has real interpolation"), but DO continue visiting its ${...} spans
    // below so a literal embedded inside an interpolation (e.g.
    // `Bearer ${token || "fallback-secret"}`) is still independently caught.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (isTypeofComparisonOperand(node)) return; // ECMAScript typeof-result literal, not a candidate at all
      recordLiteral(node, node.text, false);
      return; // don't descend into a plain string literal's own children (it has none of interest)
    }
    if (ts.isTemplateExpression(node)) {
      recordLiteral(node, node.getText().replace(/^`|`$/g, ""), false);
      // fall through to visit children (the ${...} expressions) below
    }
    if (ts.isNumericLiteral(node)) {
      recordLiteral(node, node.text, true);
      return;
    }
    ts.forEachChild(node, visit);
  }

  function recordLiteral(node: ts.Node, value: string, isNumeric: boolean) {
    if (value.length < 1) return;
    const { line, column } = posOf(node);
    const parent = node.parent;

    let identifierName: string | null = null;
    let propertyName: string | null = null;

    if (parent) {
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) identifierName = parent.name.text;
      else if (ts.isPropertyAssignment(parent)) {
        propertyName = parent.name.getText().replace(/^['"`]|['"`]$/g, "");
      } else if (ts.isParameter(parent) && ts.isIdentifier(parent.name)) {
        identifierName = parent.name.text; // default-value position
      } else if (ts.isBinaryExpression(parent) && (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken)) {
        if (ts.isIdentifier(parent.left) || ts.isPropertyAccessExpression(parent.left)) identifierName = parent.left.getText();
      }
    }

    const comparisonKey = findComparisonKey(node);
    const callCtx = findCallContext(node);
    const parentFunction = findParentFunctionName(node);
    const isImportExport = isInsideImportExport(node);

    // Special-case: Supabase-style query builder .eq/.neq/.gt/.gte/.lt/.lte/.in/.contains(column, value)
    // — arg0 is the column NAME (a schema identifier), arg1 is the compared VALUE
    // (often a workflow-state or business value). If this literal is arg1 and the
    // sibling arg0 is itself a plain string literal, use arg0's text as context_key
    // for arg1 — a real, evidence-based context signal from the call shape itself,
    // not a guess from value content.
    let queryColumnContext: string | null = null;
    if (callCtx && /\.(eq|neq|gt|gte|lt|lte|in|contains|update)$/.test(callCtx.target) && callCtx.argPosition === 1) {
      const callExpr = findEnclosingCall(node);
      const arg0 = callExpr?.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) queryColumnContext = arg0.text;
    }

    const contextKey = identifierName ?? propertyName ?? comparisonKey ?? queryColumnContext ?? "";

    let usageContext = "unknown";
    if (isImportExport) usageContext = "import-export-specifier";
    else if (propertyName) usageContext = `property:${propertyName}`;
    else if (identifierName) usageContext = `assignment:${identifierName}`;
    else if (comparisonKey) usageContext = `comparison:${comparisonKey}`;
    else if (callCtx) usageContext = `call:${callCtx.target}#arg${callCtx.argPosition}`;
    else if (parent && ts.isReturnStatement(parent)) usageContext = "return-value";
    else if (parent && ts.isArrayLiteralExpression(parent)) usageContext = "array-element";
    else if (parent && ts.isCaseClause(parent)) usageContext = "switch-case";

    hits.push({
      value,
      file: filePath,
      line,
      column,
      is_numeric: isNumeric,
      identifier_name: identifierName,
      property_name: propertyName,
      parent_function: parentFunction,
      call_target: callCtx?.target ?? null,
      arg_position: callCtx?.argPosition ?? null,
      ast_node_type: isNumeric ? "NumericLiteral" : ts.SyntaxKind[node.kind],
      is_import_export: isImportExport,
      file_category: fileCategory,
      usage_context: usageContext,
      context_key: contextKey,
    });
  }

  function findEnclosingCall(node: ts.Node): ts.CallExpression | null {
    let cur: ts.Node | undefined = node.parent;
    while (cur) {
      if (ts.isCallExpression(cur)) return cur;
      if (ts.isBlock(cur) || ts.isSourceFile(cur)) return null;
      cur = cur.parent;
    }
    return null;
  }

  visit(sourceFile);
  return hits;
}
