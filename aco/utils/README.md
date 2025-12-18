# ACO Utilities

Manual utilities for ACO operations. These are not part of the standard workflow but are useful for troubleshooting and one-off operations.

## Available Utilities

### `delete-by-sku-list.js`

Delete specific products from ACO by providing a JSON file with SKU list.

**Usage:**
```bash
node aco/utils/delete-by-sku-list.js /path/to/skus.json
```

**SKU file format:**
```json
["SKU1", "SKU2", "SKU3"]
```

**When to use:**
- Manual cleanup of specific products
- Removing orphaned products that aren't in your data pack
- Testing deletion of a subset of products

### `EXTRACT-SKUS-FROM-DATA-SYNC.md`

Browser console script to extract SKU list from ACO Data Sync UI.

**When to use:**
- Identifying what products are actually in ACO
- Finding orphaned products
- Comparing ACO state with your data pack

**Workflow:**
1. Open ACO Data Sync in browser
2. Run the console script from the documentation
3. Save extracted SKUs to a file
4. Use `delete-by-sku-list.js` to delete them

## Standard Workflow

For normal operations, use the standard scripts instead:

- `npm run delete:aco` - Delete all data (uses data pack as source of truth)
- `npm run import:aco` - Import all data from data pack

These utilities are only needed for manual interventions.

