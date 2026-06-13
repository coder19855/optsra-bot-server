# Documentation Standards

This project uses JSDoc for all public-facing code (classes, functions, interfaces, types).

## Rules
1. **Consistency:** All exported symbols must have JSDoc.
2. **Completeness:** Include `@param` for all parameters, `@returns` for return values, and a concise description.
3. **Types:** Leverage TypeScript's type system; JSDoc should focus on *why* and *how* for complex logic.
4. **Examples:** Use `@example` for non-obvious logic or complex data transformations.
5. **Typedefs:** Use `@typedef` for complex object shapes that are used across multiple files.

## Example
```typescript
/**
 * Computes the confluent decision based on technical analysis and option flow metrics.
 * 
 * @param {MarketContext} context - The current market snapshot.
 * @param {TradingStyle} style - The active trading style.
 * @returns {TradeDecisionResult} The calculated decision and conviction score.
 */
```
