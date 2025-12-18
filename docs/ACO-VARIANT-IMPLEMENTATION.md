# ACO Variant Implementation

## Overview

Successfully implemented product variants in ACO with proper schema and ingestion flow.

## Data Structure

### Products (161 total)
- **146 simple products** - Standalone products with `visibleIn: ['CATALOG', 'SEARCH']`
- **15 configurable products** - Parent products with variant options

### Variants (120 total)
- Child products linked to configurable parents
- Each variant has:
  - `visibleIn: []` - **Invisible** (not individually shown in catalog)
  - `links: [{ type: "VARIANT_OF", sku: "parent-sku" }]` - Links to parent
  - `variantReferenceId` on configurable attributes - Maps to option values

**Total: 281 products**

## Variant Schema

```json
{
  "sku": "STR-463A0B4C-VAR-5B1A504F",
  "name": "...",
  "visibleIn": [],
  "attributes": [
    {
      "code": "br_depth",
      "values": ["1.75"],
      "variantReferenceId": "STR-463A0B4C-CONFIG"
    },
    {
      "code": "br_width",
      "values": ["5.5"],
      "variantReferenceId": "STR-463A0B4C-CONFIG"
    },
    {
      "code": "br_length",
      "values": ["8"],
      "variantReferenceId": "STR-463A0B4C-CONFIG"
    }
  ],
  "links": [
    {
      "type": "VARIANT_OF",
      "sku": "STR-463A0B4C-CONFIG"
    }
  ]
}
```

**Key Points:**
- ❌ `variantReferenceId` NOT at product root
- ✅ `variantReferenceId` IN configurable attribute objects
- ✅ `links` array with `VARIANT_OF` relationship
- ✅ `visibleIn: []` makes variants invisible (correct for UX)

## Ingestion Flow

```
1. Categories   → Base taxonomy
2. Metadata     → Attribute definitions
3. Products     → 161 products (146 simple + 15 configurable)
   └─ Verify    → Poll GraphQL until all indexed (~42s)
4. Variants     → 120 variants (children of configurables)
   └─ No verify → Cannot verify invisible products via GraphQL (~20s)
5. Price Books  → Pricing structure
6. Prices       → Product pricing
```

## Why Variants Aren't Verified

### The Problem
- **Variants** have `visibleIn: []` (invisible)
- **GraphQL API** only returns visible products
- **Verification** polls GraphQL to confirm products are indexed
- **Result**: Variants never appear in GraphQL queries (by design)

### The Solution
- Products: ✅ Verify via GraphQL (they're visible)
- Variants: ✅ Skip verification (they're invisible)
- Confirmation: Data Ingestion API returns `ACCEPTED` status

### Why This Is Correct
Variants aren't meant to be individually queryable. The storefront flow is:
1. Show configurable product in catalog
2. User selects options (size, color, etc.)
3. System resolves to specific variant SKU
4. Variant is added to cart

The variants work correctly in the storefront even though they don't appear in GraphQL `products()` queries.

## Performance

**Full Import (Clean Slate)**
- Categories: <1s (36 items)
- Metadata: <1s (64 items)
- Products: ~70s (161 items with verification)
- Variants: ~20s (120 items, no verification)
- Price Books: <1s (5 items)
- Prices: ~5s (1330 items)
- **Total: ~2 minutes**

**Full Delete**
- Prices: ~5s
- Price Books: <1s
- Products: ~45s (281 items = 161 products + 120 variants)
- Metadata: <1s
- **Total: ~50 seconds**

## Key Files

**Generation:**
- `commerce-demo-generator/generators/generate-aco.js`
  - `transformToAcoVariant()` - Adds `variantReferenceId` to configurable attributes
  - `buildConfigurableAttributesMap()` - Maps parent SKU to configurable attribute codes

**Ingestion:**
- `commerce-demo-ingestion/aco/importers/products.js` - Products with verification
- `commerce-demo-ingestion/aco/importers/variants.js` - Variants without verification

**Data:**
- `buildright-data/generated/aco/products.json` - 161 products
- `buildright-data/generated/aco/variants.json` - 120 variants

## Usage

```bash
# Generate ACO data from Commerce
cd commerce-demo-generator
npm run generate:aco

# Import to ACO
cd ../commerce-demo-ingestion
npm run import:aco

# Delete from ACO
npm run delete:aco
```

## Troubleshooting

**Issue**: Variants failing to ingest with schema errors

**Check**:
```bash
# Verify schema is correct
cd buildright-data/generated/aco
node -e "
const v = require('./variants.json')[0];
console.log('Has variantReferenceId at root:', 'variantReferenceId' in v);
console.log('Has variantReferenceId in attrs:', v.attributes.some(a => 'variantReferenceId' in a));
"
# Should show: false, true
```

**Solution**: Regenerate data with `npm run generate:aco`

---

**Issue**: Import hanging during variant verification

**Cause**: Variants are invisible, so GraphQL never returns them

**Solution**: Already fixed - verification is skipped for variants

