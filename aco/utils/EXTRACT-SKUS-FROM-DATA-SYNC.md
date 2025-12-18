# Extract SKUs from ACO Data Sync Grid

Utility for extracting product SKUs from the ACO Data Sync UI when manual cleanup is needed.

## When to Use This

Use this utility when:
- You need to identify orphaned products in ACO
- The ACO UI shows products that aren't in your data pack
- You want to verify what's actually in ACO vs. what should be there

## How to Use

### Step 1: Open ACO Data Sync

1. Navigate to the ACO Data Sync page in Adobe Commerce Optimizer
2. Go to the "Overview" tab
3. Ensure the product grid is visible

### Step 2: Run Browser Console Script

Open the browser console (F12 or Cmd+Option+I) and paste this script:

```javascript
(async function extractSKUsFromDataSync() {
  console.log('🔍 Starting SKU extraction from Data Sync grid...');
  
  // Find the SKU column index
  const iframe = document.querySelector('iframe[title*="Data Sync"]');
  if (!iframe) {
    console.error('❌ Could not find Data Sync iframe');
    return;
  }
  
  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  const headers = Array.from(iframeDoc.querySelectorAll('[role="columnheader"]'));
  const skuColumnIndex = headers.findIndex(h => h.textContent.trim().toLowerCase() === 'sku');
  
  if (skuColumnIndex === -1) {
    console.error('❌ Could not find SKU column');
    return;
  }
  
  console.log(`✓ Found SKU column at index ${skuColumnIndex}`);
  
  // Find scrollable container
  const scrollables = Array.from(iframeDoc.querySelectorAll('[role="grid"]'))
    .map(grid => {
      let parent = grid.parentElement;
      while (parent && parent !== iframeDoc.body) {
        const style = window.getComputedStyle(parent);
        if (style.overflow === 'auto' || style.overflowY === 'auto') {
          return parent;
        }
        parent = parent.parentElement;
      }
      return null;
    })
    .find(el => el !== null);
  
  if (!scrollables) {
    console.error('❌ Could not find scrollable container');
    return;
  }
  
  console.log('✓ Found scrollable container');
  
  // Extract SKUs with scrolling
  const skus = new Set();
  let lastCount = 0;
  let noChangeCount = 0;
  let scrollAttempts = 0;
  const maxScrollAttempts = 100;
  
  while (scrollAttempts < maxScrollAttempts) {
    // Extract visible SKUs
    const rows = iframeDoc.querySelectorAll('[role="row"]');
    rows.forEach(row => {
      const cells = row.querySelectorAll('[role="gridcell"]');
      if (cells.length > skuColumnIndex) {
        const sku = cells[skuColumnIndex].textContent.trim();
        if (sku && sku !== 'SKU') {
          skus.add(sku);
        }
      }
    });
    
    // Check if we found new SKUs
    if (skus.size === lastCount) {
      noChangeCount++;
      if (noChangeCount >= 3) {
        console.log('✓ No new SKUs found after 3 scroll attempts, stopping');
        break;
      }
    } else {
      noChangeCount = 0;
      console.log(`Extracted ${skus.size} SKUs (Total unique: ${skus.size})`);
    }
    
    lastCount = skus.size;
    
    // Scroll down
    scrollables.scrollTop += 500;
    await new Promise(resolve => setTimeout(resolve, 500));
    scrollAttempts++;
  }
  
  console.log('');
  console.log('============================================================');
  console.log(`✅ Extraction complete! Found ${skus.size} unique SKUs`);
  console.log('============================================================');
  console.log('');
  
  // Convert to array and display
  const skuArray = Array.from(skus).sort();
  
  console.log('First 20 SKUs:');
  console.log(skuArray.slice(0, 20));
  console.log('');
  
  // Try to copy to clipboard
  const jsonOutput = JSON.stringify(skuArray, null, 2);
  try {
    await navigator.clipboard.writeText(jsonOutput);
    console.log('📋 SKUs copied to clipboard!');
  } catch (err) {
    console.log('📋 Could not auto-copy. Copy manually from below:');
    console.log('');
    console.log(jsonOutput);
  }
  
  console.log('');
  console.log('To delete these products, save to file:');
  console.log('/tmp/skus-to-delete.json');
  console.log('');
  console.log('Then run:');
  console.log('cd commerce-demo-ingestion');
  console.log('node aco/utils/delete-by-sku-list.js /tmp/skus-to-delete.json');
  
  return skuArray;
})();
```

### Step 3: Save and Delete

1. The script will copy the SKU list to your clipboard
2. Save the JSON array to a file (e.g., `/tmp/skus-to-delete.json`)
3. Run the deletion utility:

```bash
cd commerce-demo-ingestion
node aco/utils/delete-by-sku-list.js /tmp/skus-to-delete.json
```

## Notes

- The script automatically scrolls through the grid to find all products
- It stops when no new SKUs are found after 3 scroll attempts
- The output is a JSON array that can be directly used with `delete-by-sku-list.js`
- This is a read-only operation - it only extracts SKUs, it doesn't modify anything

## Related Files

- `delete-by-sku-list.js` - Companion utility to delete the extracted SKUs
- `../delete.js` - Main deletion script (uses data pack as source of truth)

