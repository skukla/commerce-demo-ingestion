# Variant Visibility Toggle Strategy

## Problem Statement

**Challenge**: Variants in ACO need to be invisible (`visibleIn: []`) in production, but this creates two critical problems:

1. **Verification Problem**: Invisible variants cannot be verified via GraphQL, leading to simulated delays instead of real verification
2. **Cleanup Problem**: Interrupted imports leave orphaned invisible variants that cannot be found by `--scan` (which queries GraphQL)

## Solution: Two-Phase Visibility Toggle

We implement a **two-phase visibility toggle** for both import and delete operations:

### Import Flow

```
1. Generate variants with visibleIn: ['CATALOG', 'SEARCH']
   ↓
2. Import variants (visible)
   ↓
3. Verify via GraphQL (REAL verification, not simulated!)
   ↓
4. Update variants to visibleIn: []
   ↓
5. Wait for indexing to confirm invisibility
```

### Delete Flow

```
1. Check state tracker for variant SKUs
   ↓
2. Update variants to visibleIn: ['CATALOG', 'SEARCH']
   ↓
3. Wait for indexing
   ↓
4. Run --scan to find and delete ALL products (including variants)
```

## Benefits

### ✅ Real Verification
- No more simulated timing delays
- Actual GraphQL verification confirms variants are indexed
- Catches errors immediately during import

### ✅ Interrupted Import Recovery
- If import is cancelled/interrupted, variants are still visible
- `--scan` can find and delete them
- No orphaned invisible variants left behind

### ✅ Production State
- Final state is correct: variants are invisible
- Configurable products work as expected
- Storefronts don't show variants as standalone products

## Implementation Details

### 1. Generator (`generate-aco.js`)

**Environment Variable**: `VARIANT_INITIAL_VISIBLE`
- **DEFAULT** (`undefined` or any value except `'false'`): Variants are generated with `visibleIn: ['CATALOG', 'SEARCH']` (for verification)
- `false` (explicit): Variants are generated with `visibleIn: []` (for testing invisible variants)

```javascript
// Default: variants are visible (for verification during import)
const variantInitialVisible = process.env.VARIANT_INITIAL_VISIBLE !== 'false';

if (variantInitialVisible) {
  acoProduct.visibleIn = ['CATALOG', 'SEARCH'];
} else {
  acoProduct.visibleIn = [];
}
```

**User Workflow**:
1. Run `npm run generate:aco` (creates visible variants by default)
2. Run `npm run import:aco` (imports → verifies → toggles to invisible)

### 2. Import Script (`import.js`)

**No regeneration step needed!** Import assumes variants are already generated as visible (default behavior).

### 3. Variants Importer (`importers/variants.js`)

**Phase 1**: Verify variants (visible)
```javascript
// Real GraphQL verification (same as products)
const detector = new SmartDetector();
const foundProducts = await detector.queryACOProductsBySKUs(skusToVerify);
```

**Phase 2**: Toggle to invisible
```javascript
// Update visibility
await client.updateProducts(variantsToUpdate.map(v => ({
  sku: v.sku,
  source: { locale: 'en-US' },
  visibleIn: [] // Make invisible
})));

// Wait for indexing (15 seconds)
```

### 4. Delete Script (`delete.js`)

**Before Scanning**: Make variants visible

```javascript
if (forceScan || stateIsEmpty) {
  // Update all tracked SKUs to be visible
  await client.updateProducts(skus.map(sku => ({
    sku,
    source: { locale: 'en-US' },
    visibleIn: ['CATALOG', 'SEARCH']
  })));
  
  // Wait for indexing (15 seconds)
  
  // Now --scan can find them
  const acoProducts = await detector.queryACOProductsDirect();
}
```

## Usage

### Step 1: Generate Data (with visible variants)

```bash
cd commerce-demo-generator
npm run generate:aco
```

**What happens**:
- Variants are generated with `visibleIn: ['CATALOG', 'SEARCH']` by default
- Ready for verification during import

### Step 2: Import Data (with visibility toggle)

```bash
cd commerce-demo-ingestion
npm run import:aco
```

**What happens**:
1. Categories → Metadata → Products imported
2. Variants imported (already visible from Step 1)
3. Variants verified via GraphQL ✅
4. Variants toggled to invisible ✅
5. Final state: variants are invisible

### Delete with Scan

```bash
npm run delete:aco -- --scan
```

**What happens**:
1. State tracker checked for variant SKUs
2. Variants updated to visible
3. Indexing wait (15 seconds)
4. Scan finds ALL products (including variants)
5. Everything deleted

### Recovering from Interrupted Import

If import is interrupted, variants are still visible:

```bash
npm run delete:aco -- --scan
```

✅ **Scan will find and delete orphaned variants** (because they're visible)

## Timing

### Import Timing
- **Variant Import**: ~30 seconds (varies by count)
- **Verification**: ~1-2 minutes (real GraphQL polling)
- **Visibility Toggle**: ~5 seconds
- **Indexing Confirmation**: ~15 seconds
- **Total**: ~2-3 minutes for 120 variants

### Delete Timing  
- **Make Visible**: ~2-5 seconds
- **Indexing Wait**: ~15 seconds
- **Scan**: ~5 seconds
- **Delete**: ~45 seconds (varies by count)
- **Search & Recs Sync**: ~15 seconds
- **Total**: ~1.5 minutes for 281 products

## SDK Support

This approach is fully supported by the ACO SDK:

```typescript
// From @adobe-commerce/aco-ts-sdk v1.2.2

interface FeedProductUpdate {
  sku: string;
  source: Source;
  visibleIn?: FeedProductUpdateVisibleInEnum[]; // ✅ Supported!
  // ... other fields
}

enum FeedProductUpdateVisibleInEnum {
  Catalog = "CATALOG",
  Search = "SEARCH"
}

client.updateProducts(data: FeedProductUpdate[]): Promise<ApiResponse>;
```

## Alternative Approaches Considered

### ❌ Keep Variants Invisible + Simulated Delay
- **Problem**: No real verification, orphaned variants on interruption
- **Why rejected**: Not robust, can't recover from failures

### ❌ Extract Variant SKUs + delete-by-sku-list.js  
- **Problem**: Manual process, requires SKU extraction script
- **Why rejected**: Not automated, error-prone

### ✅ Two-Phase Visibility Toggle (Current)
- **Benefits**: Automated, robust, real verification
- **Trade-off**: Slightly longer import time (~20 seconds extra)
- **Decision**: Worth it for reliability

## Troubleshooting

### Variants Still Visible After Import

**Check**: Did the visibility toggle complete?

```bash
# Query ACO to check variant visibility
node aco/test-query-variants.js
```

**Fix**: Manually toggle to invisible
```bash
# Create script: toggle-variants-invisible.js
const variantSkus = [...]; // Your variant SKUs
await client.updateProducts(variantSkus.map(sku => ({
  sku,
  source: { locale: 'en-US' },
  visibleIn: []
})));
```

### Scan Not Finding Orphaned Variants

**Check**: Are they still invisible?

**Fix**: Use the state tracker or extract SKUs manually
```bash
# Option 1: Use state tracker
npm run delete:aco

# Option 2: Extract and delete by SKU list
node aco/extract-variant-skus.js
node aco/delete-by-sku-list.js /tmp/variant-skus.json
```

## References

- ACO SDK TypeScript definitions: `node_modules/@adobe-commerce/aco-ts-sdk/dist/index.d.ts`
- Data Ingestion API: Lines 1962-1976 (updateProducts)
- Variant implementation: `docs/ACO-VARIANT-IMPLEMENTATION.md`

