# Research: Brand Generation Issues

**Date**: 2026-01-03
**Scope**: Codebase analysis
**Depth**: Standard

## Summary

The brand import failure is caused by a **data synchronization gap** between where brands are defined for products vs. where they're defined for attribute options. Products use 72+ category-specific brands, but attribute options only define 10 generic brands.

## Root Cause Analysis

### The Disconnect

| Source | Location | Brand Count |
|--------|----------|-------------|
| Product Generation | `brands.json` → `categorySpecific` | **72+ brands** |
| Attribute Options | `product-attributes.json` → `br_brand.options` | **10 brands** |

When products are generated, they get assigned brands like "Pacific Northwest Lumber" from category-specific lists. But the `br_brand` attribute only has options for generic brands like "BuildRight Pro", "StructureMaster", etc.

### Error Message

```
Attribute "br_brand" has invalid value. The "Pacific Northwest Lumber" value's type is invalid. The "int" type was expected.
```

This indicates Commerce received a string brand name when it expected an integer option ID.

## Key Files

### Brand Definition
- `buildright-data/definitions/products/brands.json` - Contains 72+ category-specific brands

### Attribute Definition (PROBLEM)
- `buildright-data/definitions/attributes/product-attributes.json:3-24` - Only 10 generic brands

### Product Generation
- `commerce-demo-generator/generators/products.js:84-85` - Uses `BRANDS_BY_CATEGORY[subcategory]` (72+ brands)

### Import Phase
- `commerce-demo-ingestion/commerce/importers/products.js:383-441` - Tries to map brand names to option IDs, fails when brand not in options

## Data Flow Breakdown

```
┌─────────────────────────────────────────────────────────────────┐
│ GENERATION                                                       │
├─────────────────────────────────────────────────────────────────┤
│ brands.json                    product-attributes.json          │
│ ├─ categorySpecific (72+)     ├─ br_brand.options (10)         │
│ │  ├─ lumber: 4 brands        │  ├─ BuildRight Pro             │
│ │  ├─ roofing: 4 brands       │  ├─ StructureMaster            │
│ │  └─ ... 27 categories       │  └─ ... 8 more generic         │
│ └─ generic (10)               └─────────────────────────────────│
│                                                                  │
│ products.js picks from categorySpecific → "Pacific NW Lumber"   │
│ attributes picks from product-attributes → 10 options only      │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│ GENERATED DATA PACK                                              │
├─────────────────────────────────────────────────────────────────┤
│ accs_products.json          accs_product_attributes.json        │
│ ├─ br_brand: "Pacific NW"   ├─ br_brand options: 10 generic    │
│ ├─ br_brand: "Cascade Tim"  └─ (no category-specific brands)   │
│ └─ 72+ unique values                                            │
└─────────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│ IMPORT (Commerce API)                                           │
├─────────────────────────────────────────────────────────────────┤
│ 1. Create br_brand attribute with 10 options                   │
│ 2. Build optionMap: { "BuildRight Pro": 1, ... }               │
│ 3. Import products:                                             │
│    ├─ optionMap["Pacific NW Lumber"] → undefined               │
│    └─ Skip attribute OR fail with "int type expected"           │
└─────────────────────────────────────────────────────────────────┘
```

## Solution Options

### Option 1: Unify Brand Source (Recommended)

- **Single source of truth** for brands used by BOTH product generation AND attribute options
- Update `product-attributes.json` to dynamically include ALL brands from `brands.json`
- **Pros**: Complete consistency, all category-specific brands available
- **Cons**: Larger attribute option list (72+ options)

### Option 2: Restrict Products to Generic Brands

- Modify product generation to ONLY use the 10 generic brands
- **Pros**: Simple fix, minimal attribute options
- **Cons**: Loses the category-specific brand variety

### Option 3: Generate Attributes from Products (Post-Processing)

- After generating products, extract all unique `br_brand` values
- Dynamically build attribute options from actual product data
- **Pros**: Always in sync by construction
- **Cons**: Requires generation pipeline change

## Common Pitfalls

1. **Attribute options require integer IDs** - Commerce expects option IDs, not string values
2. **Silent failures** - The importer currently skips missing options instead of failing loudly
3. **Seeded randomness** - Brand selection uses SeededRandom (seed 12345), so regenerating will produce same products with same brands

## Key Takeaways

1. The `br_brand` attribute in `product-attributes.json` has been static with 10 generic brands
2. Product generation uses 72+ category-specific brands from a separate `brands.json` file
3. These two sources were never synchronized
4. The fix requires establishing a single source of truth for brands

## Recommended Next Steps

1. Choose a solution option (recommend Option 1 or Option 3)
2. Update the generator to ensure brand consistency
3. Regenerate the data pack
4. Delete existing Commerce/ACO data
5. Re-import with consistent brand data
