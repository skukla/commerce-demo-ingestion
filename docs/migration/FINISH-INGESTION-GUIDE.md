# Quick Guide: Finish commerce-demo-ingestion

**Time needed:** 2-3 hours  
**Current status:** 80% complete, just need to update imports

## What's Left

Update 9 import scripts to use relative paths and read from data repository.

## Pattern to Follow

For each file in the list below, make these changes:

### 1. Update Imports

**Find and replace #shared imports:**
```javascript
// BEFORE:
import { X } from '#shared/Y';

// AFTER:
import { X } from '../shared/Y.js';  // or '../../shared/Y.js' depending on file depth
```

**Find and replace #config imports:**
```javascript
// BEFORE:
import { COMMERCE_CONFIG } from '#config/commerce-config';

// AFTER:
import { COMMERCE_CONFIG } from '../shared/config-loader.js';  // or '../../shared/config-loader.js'
```

### 2. Update Datapack Paths

**Find hardcoded datapack paths:**
```javascript
// BEFORE:
const DATAPACK_PATH = resolve(__dirname, '../output/buildright-datapack/data/accs/accs_products.json');

// AFTER:
const DATA_REPO = process.env.DATA_REPO_PATH || '../buildright-data';
const DATAPACK_PATH = resolve(DATA_REPO, 'generated/commerce/data/accs/accs_products.json');
```

## Files to Update

### Commerce Import Scripts (9 files)

1. **commerce/products/import.js**
   - Relative path from commerce/products/ to shared/: `../../shared/`
   - Update datapack path to use DATA_REPO

2. **commerce/categories/import.js**
   - Relative path: `../../shared/`
   - Update datapack path

3. **commerce/attributes/import.js**
   - Relative path: `../../shared/`
   - Update datapack path

4. **commerce/attributes/import-customer-attributes.js**
   - Relative path: `../../shared/`
   - Update datapack path

5. **commerce/customers/import.js**
   - Relative path: `../../shared/`
   - Update datapack path

6. **commerce/customers/import-groups.js**
   - Relative path: `../../shared/`
   - Update datapack path

7. **commerce/stores/import.js**
   - Relative path: `../../shared/`
   - Update datapack path

8. **commerce/images/import.js**
   - Relative path: `../../shared/`
   - Update datapack path

9. **commerce/delete-all.js**
   - Relative path: `../shared/`
   - May need to update any buildright-specific references

### Shared Utilities (if needed)

10. **shared/state-tracker.js**
    - Update STATE_DIR to use PROJECT_CONFIG.identifier:
    ```javascript
    import { PROJECT_CONFIG } from './config-loader.js';
    const STATE_DIR = join(process.cwd(), `.${PROJECT_CONFIG.identifier}-state`);
    ```

## Example: Updating products/import.js

### Step 1: Check current imports

```bash
cd commerce-demo-ingestion
grep "#shared\|#config" commerce/products/import.js
```

### Step 2: Update imports

```javascript
// OLD:
import { BaseImporter } from '#shared/base-importer';
import { COMMERCE_CONFIG } from '#config/commerce-config';
import { getStateTracker } from '#shared/state-tracker';

// NEW:
import { BaseImporter } from '../../shared/base-importer.js';
import { COMMERCE_CONFIG } from '../../shared/config-loader.js';
import { getStateTracker } from '../../shared/state-tracker.js';
```

### Step 3: Update datapack path

```javascript
// OLD:
const DATAPACK_PRODUCTS_PATH = resolve(__dirname, '../output/buildright-datapack/data/accs/accs_products.json');

// NEW:
const DATA_REPO = process.env.DATA_REPO_PATH || '../buildright-data';
const DATAPACK_PRODUCTS_PATH = resolve(DATA_REPO, 'generated/commerce/data/accs/accs_products.json');
```

### Step 4: Test

```bash
# Check for syntax errors
node commerce/products/import.js --help

# If no errors, move to next file
```

## Testing After Updates

Once all files are updated:

```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env
vi .env  # Add Commerce credentials and DATA_REPO_PATH

# 3. Test import
npm run import:commerce

# 4. If successful, test delete
npm run delete:commerce
```

## Common Issues

### Issue: "Cannot find module"

**Solution:** Check the relative path depth
- From `commerce/*.js` to `shared/`: `../shared/`
- From `commerce/*/*.js` to `shared/`: `../../shared/`

### Issue: "Cannot read property of undefined"

**Solution:** Make sure config-loader.js is working:
```bash
node -e "import('./shared/config-loader.js').then(m => console.log(m.PROJECT_CONFIG))"
```

### Issue: "File not found" for datapack

**Solution:** Check DATA_REPO_PATH in .env points to buildright-data

## Validation Checkpoint

After updating a file, check:

- [ ] No #shared imports remain
- [ ] No #config imports remain
- [ ] Datapack paths use DATA_REPO
- [ ] File has no syntax errors
- [ ] Imports use .js extension

## Quick Search & Replace

For VSCode users, use these regex find/replace in each file:

1. **Find:** `from '#shared/(.+)';`  
   **Replace:** `from '../shared/$1.js';` or `from '../../shared/$1.js';`

2. **Find:** `from '#config/commerce-config';`  
   **Replace:** `from '../shared/config-loader.js';` or `from '../../shared/config-loader.js';`

3. **Find:** `'../output/buildright-datapack`  
   **Replace:** Look for this pattern and update case-by-case

## Completion Checklist

- [ ] All 9 commerce import scripts updated
- [ ] state-tracker.js updated
- [ ] npm install successful
- [ ] .env configured
- [ ] Import test successful
- [ ] Delete test successful
- [ ] Commit changes
- [ ] Update IMPLEMENTATION-PROGRESS.md

## Time Estimates

- Products import: 15 min
- Categories import: 15 min
- Attributes import: 15 min
- Customer attributes import: 15 min
- Customers import: 15 min
- Customer groups import: 15 min
- Stores import: 15 min
- Images import: 15 min
- Delete script: 15 min
- State tracker: 10 min
- Testing: 30 min
- **Total: 2.5 hours**

## Questions?

See:
- `IMPLEMENTATION-PROGRESS.md` for overall status
- `README-3-REPO-ARCHITECTURE.md` for architecture details
- `3-REPO-QUICK-START.md` for usage examples

