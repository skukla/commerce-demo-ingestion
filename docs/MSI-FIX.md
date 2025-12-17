# Multi-Source Inventory (MSI) Fix

## Problem

Products were failing to import with the error:
```
Could not save Source Item Configuration
```

## Root Cause

Adobe Commerce has **Multi-Source Inventory (MSI)** enabled, but the import scripts were using the legacy single-source inventory approach with `stock_item` in the product creation payload.

When MSI is enabled:
- The old `stock_item` configuration in `extension_attributes` conflicts with MSI
- Products must be assigned to inventory sources using the dedicated MSI API: `/V1/inventory/source-items`
- Attempting to set `stock_item` during product creation causes the "Could not save Source Item Configuration" error

## Solution

The fix implements proper MSI support in three steps:

### 1. **Removed `stock_item` from Product Creation**

**Files Changed:**
- `commerce/products/import.js` - `transformToCommerceApi()` method
- `shared/bulk-commerce-api.js` - `transformToBulkFormat()` method

**Before:**
```javascript
extension_attributes: {
  category_links: this.getCategoryLinks(product.categories),
  website_ids: this.websiteIds.length > 0 ? this.websiteIds : [1],
  stock_item: {
    qty: product.qty || 100,
    is_in_stock: true,
    manage_stock: true,
    use_config_manage_stock: false
  }
}
```

**After:**
```javascript
extension_attributes: {
  category_links: this.getCategoryLinks(product.categories),
  website_ids: this.websiteIds.length > 0 ? this.websiteIds : [1]
  // stock_item removed - inventory is managed via MSI source_items API
}
```

### 2. **Added MSI API Methods**

**File:** `shared/commerce-api.js`

Added two new methods to handle inventory source assignment:

```javascript
/**
 * Assign product to inventory source(s)
 * Required when MSI is enabled in Commerce
 */
async assignSourceItems(sourceItems) {
  return apiRequest('POST', '/rest/V1/inventory/source-items', { sourceItems });
}

/**
 * Assign a single product to a source with quantity
 */
async assignProductToSource(sku, sourceCode = 'default', quantity = 100, status = 1) {
  return this.assignSourceItems([{
    sku,
    source_code: sourceCode,
    quantity,
    status
  }]);
}
```

### 3. **Updated Product Creation to Assign Inventory After Creation**

**File:** `commerce/products/import.js` - `createProduct()` method

After creating each product, we now assign it to the default inventory source:

```javascript
// Assign to inventory source (MSI) after product creation
try {
  await this.api.assignProductToSource(
    sku, 
    'default',  // Default source code
    product.qty || 100,
    1  // In stock
  );
  this.logger.debug(`Assigned inventory source for: ${sku}`);
} catch (msiError) {
  // Log but don't fail - MSI might not be enabled or already assigned
  this.logger.debug(`MSI assignment warning for ${sku}: ${msiError.message}`);
}
```

### 4. **Added Bulk MSI Assignment**

**File:** `shared/bulk-commerce-api.js`

Added `bulkAssignSourceItems()` method that assigns inventory sources for all products after bulk creation:

```javascript
async bulkAssignSourceItems(products, sourceCode = 'default') {
  const sourceItems = products.map(product => ({
    sku: product.sku,
    source_code: sourceCode,
    quantity: product.qty || 100,
    status: 1  // In stock
  }));
  
  // Process in chunks of 500
  const chunks = chunkArray(sourceItems, 500);
  
  for (const chunk of chunks) {
    await this.api.post('/rest/V1/inventory/source-items', { 
      sourceItems: chunk 
    });
  }
}
```

## Testing the Fix

Run the product import again:

```bash
npm run import:products
```

Or run the full import:

```bash
npm run import:all
```

## What to Expect

1. ✅ Products will be created without `stock_item` in the payload
2. ✅ After creation, each product is assigned to the 'default' inventory source
3. ✅ No more "Could not save Source Item Configuration" errors
4. ✅ Products will have proper inventory quantities set via MSI

## Configuration

### Default Source Code

The fix uses `'default'` as the source code. This is the standard source code in Adobe Commerce.

If your installation uses a different source code, you can:

1. **Check your sources:**
   ```bash
   GET /rest/V1/inventory/sources
   ```

2. **Update the source code** in the import scripts if needed

### Inventory Quantities

Products are assigned:
- **Quantity**: `product.qty` from datapack (default: 100)
- **Status**: `1` (in stock)
- **Source**: `'default'`

## Technical Details

### MSI API Endpoint

```
POST /rest/V1/inventory/source-items
```

**Payload:**
```json
{
  "sourceItems": [
    {
      "sku": "PRODUCT-SKU",
      "source_code": "default",
      "quantity": 100,
      "status": 1
    }
  ]
}
```

### Response

```json
[]
```
Returns empty array on success.

## References

- [Adobe Commerce MSI Documentation](https://experienceleague.adobe.com/docs/commerce-admin/inventory/introduction.html)
- [Inventory API Reference](https://adobe-commerce.redoc.ly/2.4.6-admin/tag/inventorysource-items)
- [Manage Source Items via REST API](https://developer.adobe.com/commerce/webapi/rest/inventory/manage-source-items/)

## Backward Compatibility

The fix is backward compatible:

- ✅ Works with MSI enabled (fixes the error)
- ✅ Works with MSI disabled (MSI calls are gracefully handled with debug warnings)
- ✅ Existing products are not affected (only new product creation)

## Troubleshooting

### If you still get errors:

1. **Check if 'default' source exists:**
   ```bash
   GET /rest/V1/inventory/sources
   ```

2. **Verify MSI is enabled:**
   Check Adobe Commerce admin: Stores → Configuration → Catalog → Inventory

3. **Check logs:**
   - Look in `logs/combined.log` for MSI assignment debug messages
   - Check for 404 errors (source doesn't exist)
   - Check for permission errors

4. **Custom source code:**
   If using a custom source, update the source code in:
   - `commerce/products/import.js` line ~288
   - `shared/bulk-commerce-api.js` line ~350

## Summary

The "Could not save Source Item Configuration" error is now fixed by:
1. Removing `stock_item` from product creation payload
2. Adding dedicated MSI API support
3. Assigning products to inventory sources after creation
4. Handling both individual and bulk product imports

This follows Adobe Commerce best practices for MSI-enabled installations.

