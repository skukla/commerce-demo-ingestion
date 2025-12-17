# ACO Scripts Audit vs Commerce Scripts

**Date:** December 16, 2025  
**Purpose:** Audit ACO scripts against improvements made to Commerce scripts  
**Focus Areas:** DRY, YAGNI, Output Formatting, Reusability, Code Organization

---

## 📊 Executive Summary

| Category | Commerce Scripts | ACO Scripts | Gap |
|----------|-----------------|-------------|-----|
| **Import Path Management** | ✅ Relative paths | ❌ Alias paths (#shared) | 🔴 CRITICAL |
| **Code Reusability** | ✅ Generic, config-driven | ❌ Project-specific | 🔴 HIGH |
| **Output Formatting** | ✅ Consistent icons/progress | ⚠️ Inconsistent | 🟡 MEDIUM |
| **DRY Principle** | ✅ BaseImporter abstraction | ❌ No abstraction | 🔴 HIGH |
| **YAGNI Principle** | ✅ Clean, minimal | ⚠️ Has unused code | 🟡 MEDIUM |
| **File Organization** | ✅ Clear structure | ❌ Missing files | 🔴 CRITICAL |
| **State Management** | ✅ Generic state tracker | ❌ ACO-specific tracker | 🟡 MEDIUM |
| **Data Loading** | ✅ Reads from data repo | ❌ Hardcoded paths | 🔴 HIGH |

**Overall Status:** 🔴 **NEEDS SIGNIFICANT REFACTORING**

---

## 🔍 Detailed Analysis

### 1. Import Path Management

#### Commerce Scripts ✅
```javascript
// All imports use relative paths
import { BaseImporter } from '../../shared/base-importer.js';
import { COMMERCE_CONFIG } from '../../shared/config-loader.js';
import { getStateTracker } from '../../shared/state-tracker.js';
```

#### ACO Scripts ❌
```javascript
// Still uses alias imports
import { updateLine, finishLine } from '#shared/progress';
import { format } from '#shared/format';
import { formatDuration } from '#shared/aco-ingest-helpers';
import { getStateTracker } from '#shared/aco-state-tracker';
```

**Issues:**
- ❌ Using `#shared` aliases that don't work in ingestion repo
- ❌ References non-existent files (`progress.js`, `aco-ingest-helpers.js`, `aco-state-tracker.js`)
- ❌ Will fail to load (as seen in testing)

**Required Changes:**
1. Update all imports to relative paths
2. Copy missing utility files OR remove dependencies
3. Consider using shared utilities from Commerce scripts

---

### 2. Code Reusability & Generic Design

#### Commerce Scripts ✅
```javascript
// Generic, config-driven
import { COMMERCE_CONFIG } from '../../shared/config-loader.js';

const websiteCode = COMMERCE_CONFIG.project.websiteCode;
const attributePrefix = COMMERCE_CONFIG.project.attributePrefix;

// Data loaded from configurable repo
const DATA_REPO = process.env.DATA_REPO_PATH || '../buildright-data';
const DATAPACK_PATH = resolve(DATA_REPO, 'generated/commerce/...');
```

#### ACO Scripts ❌
```javascript
// Hardcoded, project-specific
// Import paths reference missing subdirectories:
import { ingestMetadata } from '../attributes/ingest-metadata.js';
import { ingestProducts } from '../products/ingest-products.js';
import { ingestVariants } from '../products/ingest-variants.js';
import { ingestPriceBooks } from '../prices/ingest-price-books.js';
import { ingestPrices } from '../prices/ingest-prices.js';
```

**Issues:**
- ❌ References `../attributes/`, `../products/`, `../prices/` that don't exist in ingestion repo
- ❌ No config-loader integration
- ❌ No DATA_REPO_PATH support
- ❌ Not generic or reusable

**Current Structure:**
```
commerce-demo-ingestion/
├── aco/
│   ├── import.js          (references missing ../attributes/, etc.)
│   └── delete.js
└── (no aco subdirectories exist)
```

**Required Structure:**
```
commerce-demo-ingestion/
├── aco/
│   ├── import.js
│   ├── delete.js
│   ├── attributes/
│   │   └── ingest-metadata.js
│   ├── products/
│   │   ├── ingest-products.js
│   │   └── ingest-variants.js
│   └── prices/
│       ├── ingest-price-books.js
│       └── ingest-prices.js
```

---

### 3. DRY Principle (Don't Repeat Yourself)

#### Commerce Scripts ✅

**Abstraction Layers:**
1. **BaseImporter** - Common import logic
   - Config loading
   - API interaction
   - Error handling
   - Progress tracking
   - State management

2. **Shared Utilities**
   - `commerce-api.js` - API wrapper
   - `base-importer.js` - Base class
   - `state-tracker.js` - State management
   - `format.js` - Output formatting

3. **Optimized Patterns**
   - Pre-fetch existing data
   - Parallel processing with progress
   - Batch operations
   - Retry logic

**Example:**
```javascript
class ProductImporter extends BaseImporter {
  // Inherits:
  // - this.api (Commerce API)
  // - this.logger (logging)
  // - this.results (tracking)
  // - optimizedImport() (pattern)
  // - processWithProgress() (parallel processing)
}
```

#### ACO Scripts ❌

**No Abstraction:**
- ❌ No BaseImporter equivalent
- ❌ Each script duplicates:
  - API setup
  - Error handling
  - Progress tracking
  - State management
  - Config loading

**Example of Duplication:**
```javascript
// Each ingestion function probably has:
async function ingestProducts(context) {
  // Manual API setup
  // Manual error handling
  // Manual progress tracking
  // Manual state management
}

async function ingestVariants(context) {
  // Same boilerplate repeated
}

async function ingestPrices(context) {
  // Same boilerplate repeated again
}
```

**Impact:**
- 🔴 Code duplication across all ingest functions
- 🔴 Inconsistent error handling
- 🔴 Harder to maintain
- 🔴 No shared optimizations

---

### 4. YAGNI Principle (You Aren't Gonna Need It)

#### Commerce Scripts ✅

**Clean and Minimal:**
- ✅ Removed unused `delete-cache.js`
- ✅ Removed development comments
- ✅ Removed unused functions
- ✅ Only essential utilities included

#### ACO Scripts ⚠️

**Potential Issues:**
- ⚠️ May have unused utilities
- ⚠️ May have duplicate functionality
- ⚠️ Unclear which files are actually needed

**Need to Audit:**
1. Which utilities are actually used?
2. Are there duplicate implementations?
3. Are there deprecated functions?
4. Is the `tools/` directory needed?
5. Is the `deprecated/` directory needed?

---

### 5. Output Formatting Consistency

#### Commerce Scripts ✅

**Consistent Pattern:**
```javascript
// Consistent icons and formatting
📦 Importing stores...
✔ Importing stores (0 created, 1 existing)

📦 Importing customer groups...
✔ Importing customer groups (5 created, 0 existing)

📦 Importing products...
✔ Importing products (281 created, 0 existing in 31s)
```

**Features:**
- ✅ Emoji icons for visual consistency
- ✅ In-place line updates (`updateLine` / `finishLine`)
- ✅ Progress bars for long operations
- ✅ Duration for operations > 5s
- ✅ Clear success/failure indicators

#### ACO Scripts ⚠️

**Inconsistent:**
```javascript
// From import.js:
updateLine(`📦 Ingesting ${stepName.toLowerCase()}...`);
// ...
updateLine(message);
finishLine();
```

**Issues:**
- ⚠️ Uses `updateLine`/`finishLine` but references missing `#shared/progress`
- ⚠️ Uses `format` from missing `#shared/format`
- ⚠️ Different pattern than Commerce (lowercase "ingesting" vs "Importing")
- ⚠️ Inconsistent emoji usage

**Required Changes:**
1. Align with Commerce formatting patterns
2. Use shared `format.js` utilities
3. Standardize terminology
4. Ensure consistent visual output

---

### 6. File Organization & Structure

#### Commerce Scripts ✅

**Clear Organization:**
```
commerce/
├── import-all.js         (orchestrator)
├── delete-all.js         (cleanup)
├── products/
│   └── import.js
├── categories/
│   └── import.js
├── attributes/
│   ├── import.js
│   └── import-customer-attributes.js
├── customers/
│   ├── import.js
│   └── import-groups.js
├── stores/
│   └── import.js
└── images/
    └── import.js
```

**Benefits:**
- ✅ Logical grouping by entity type
- ✅ Clear separation of concerns
- ✅ Easy to find and maintain
- ✅ Scalable structure

#### ACO Scripts ❌

**Current Structure (Broken):**
```
aco/
├── import.js             (references missing files)
└── delete.js             (references missing files)

(Missing directories that import.js expects:)
├── attributes/           ❌ NOT FOUND
├── products/             ❌ NOT FOUND
└── prices/               ❌ NOT FOUND
```

**What Exists in buildright-aco:**
```
buildright-aco/scripts/
├── attributes/
│   └── ingest-metadata.js
├── products/
│   ├── ingest-products.js
│   └── ingest-variants.js
├── prices/
│   ├── ingest-price-books.js
│   └── ingest-prices.js
└── shared/
    └── (many utilities)
```

**Required Action:**
1. Copy missing directories from buildright-aco
2. Update imports to relative paths
3. Ensure all referenced files exist
4. Match Commerce organization pattern

---

### 7. State Management

#### Commerce Scripts ✅

**Generic State Tracker:**
```javascript
import { getStateTracker } from '../../shared/state-tracker.js';

const stateTracker = getStateTracker();
// Uses project identifier from config
const STATE_DIR = `.${PROJECT_CONFIG.identifier}-state`;
```

**Features:**
- ✅ Generic and reusable
- ✅ Dynamic state directory based on project
- ✅ Works for any project
- ✅ Consistent API

#### ACO Scripts ❌

**ACO-Specific Tracker:**
```javascript
import { getStateTracker } from '#shared/aco-state-tracker';

const stateTracker = getStateTracker();
// Uses dynamic `.${PROJECT_CONFIG.identifier}-state` directory
```

**Issues:**
- ❌ Separate implementation (code duplication)
- ❌ Not generic
- ❌ File doesn't exist in ingestion repo
- ❌ Potential incompatibility

**Decision Needed:**
1. **Option A:** Use shared state tracker (recommended)
   - Benefits: DRY, consistent, less code
   - Change: Update ACO scripts to use shared tracker
   
2. **Option B:** Keep separate ACO tracker
   - Benefits: ACO-specific features if needed
   - Change: Copy aco-state-tracker.js from buildright-aco

---

### 8. Data Loading & Configuration

#### Commerce Scripts ✅

**Config-Driven:**
```javascript
// Loads project config from data repo
import { COMMERCE_CONFIG } from '../../shared/config-loader.js';

// Reads from configurable data repo
const DATA_REPO = process.env.DATA_REPO_PATH || '../buildright-data';
const DATAPACK_PATH = resolve(DATA_REPO, 'generated/commerce/...');

// Uses project settings
const websiteCode = COMMERCE_CONFIG.project.websiteCode;
```

**Benefits:**
- ✅ No hardcoded values
- ✅ Reads from data repository
- ✅ Generic and reusable
- ✅ Easy to use with different projects

#### ACO Scripts ❌

**Hardcoded Paths (Presumably):**
```javascript
// Likely has hardcoded paths like:
const ACO_DATA_PATH = '../buildright-aco/output/buildright/';
// Or similar hardcoded references
```

**Issues:**
- ❌ Not generic
- ❌ Doesn't use DATA_REPO_PATH
- ❌ Doesn't use config-loader
- ❌ Can't work with different projects

**Required Changes:**
1. Add ACO support to config-loader
2. Update paths to read from DATA_REPO
3. Make scripts generic

---

## 🎯 Priority Improvements

### 🔴 CRITICAL (Blocking)

1. **Fix Import Paths**
   - Update all `#shared/*` to relative paths
   - Copy missing utility files
   - Ensure all imports resolve
   - **Estimated Time:** 1-2 hours

2. **Copy Missing Directories**
   - Copy `attributes/`, `products/`, `prices/` from buildright-aco
   - Update their imports to relative paths
   - Test that they load correctly
   - **Estimated Time:** 1-2 hours

3. **Add DATA_REPO Support**
   - Update paths to read from data repository
   - Add config-loader integration
   - Remove hardcoded paths
   - **Estimated Time:** 1-2 hours

### 🔴 HIGH (Important)

4. **Create ACO BaseImporter**
   - Abstract common patterns
   - Reduce code duplication
   - Standardize error handling
   - **Estimated Time:** 2-3 hours

5. **Unify State Management**
   - Decide on shared vs separate state tracker
   - Implement chosen approach
   - Test state persistence
   - **Estimated Time:** 1-2 hours

### 🟡 MEDIUM (Enhancement)

6. **Standardize Output Formatting**
   - Align with Commerce patterns
   - Use shared format utilities
   - Consistent emoji and terminology
   - **Estimated Time:** 1 hour

7. **Apply YAGNI**
   - Remove unused utilities
   - Clean up deprecated code
   - Simplify directory structure
   - **Estimated Time:** 1 hour

### 🟢 LOW (Nice to Have)

8. **Documentation**
   - Update README
   - Add code comments
   - Create usage examples
   - **Estimated Time:** 1 hour

---

## 📋 Refactoring Checklist

### Phase 1: Make It Work (4-6 hours)
- [ ] Fix all import paths to use relative paths
- [ ] Copy missing directories from buildright-aco
- [ ] Update copied files to use relative imports
- [ ] Add DATA_REPO_PATH support
- [ ] Integrate config-loader
- [ ] Test that `npm run import:aco` loads

### Phase 2: Make It Right (3-5 hours)
- [ ] Create ACO BaseImporter
- [ ] Refactor ingestion functions to extend BaseImporter
- [ ] Unify state management approach
- [ ] Remove code duplication
- [ ] Apply DRY principles throughout

### Phase 3: Make It Pretty (2-3 hours)
- [ ] Standardize output formatting
- [ ] Align with Commerce patterns
- [ ] Remove unused code (YAGNI)
- [ ] Clean up comments
- [ ] Update documentation

**Total Estimated Time:** 9-14 hours

---

## 🔄 Comparison Matrix

| Feature | Commerce | ACO | Status |
|---------|----------|-----|--------|
| **Imports Work** | ✅ Yes | ❌ No | 🔴 Broken |
| **Files Exist** | ✅ Yes | ❌ No | 🔴 Missing |
| **Generic Design** | ✅ Yes | ❌ No | 🔴 Hardcoded |
| **BaseImporter** | ✅ Yes | ❌ No | 🔴 Missing |
| **Config-Driven** | ✅ Yes | ❌ No | 🔴 Missing |
| **Data from Repo** | ✅ Yes | ❌ No | 🔴 Missing |
| **State Management** | ✅ Generic | ❌ Separate | 🟡 Inconsistent |
| **Output Format** | ✅ Consistent | ⚠️ Different | 🟡 Needs alignment |
| **Code Duplication** | ✅ Minimal | ❌ Likely high | 🔴 Needs refactor |
| **YAGNI Applied** | ✅ Yes | ⚠️ Unknown | 🟡 Needs audit |

---

## 💡 Recommendations

### Immediate Actions

1. **Copy ACO ingestion logic from buildright-aco**
   ```bash
   cd commerce-demo-ingestion/aco
   cp -r ../../../buildright-aco/scripts/attributes .
   cp -r ../../../buildright-aco/scripts/products .
   cp -r ../../../buildright-aco/scripts/prices .
   ```

2. **Update all imports to relative paths**
   - Replace `#shared/*` with `../../shared/*`
   - Replace `../attributes/` with `./attributes/`
   - Replace `../products/` with `./products/`

3. **Copy missing utilities or create adapters**
   - Either copy ACO-specific utilities
   - Or adapt to use Commerce utilities

### Long-Term Strategy

**Option A: Full Alignment (Recommended)**
- Make ACO scripts match Commerce organization
- Use shared BaseImporter
- Use shared utilities
- Maximum code reuse
- Consistent experience

**Option B: Keep Separate**
- Maintain ACO-specific patterns
- Copy all needed utilities
- Independent evolution
- More code duplication

**Recommendation:** Choose **Option A** for:
- Better maintainability
- Consistent codebase
- Reduced duplication
- Easier onboarding

---

## 📊 Impact Assessment

### If We Don't Refactor

**Risks:**
- ❌ ACO import/delete remain broken
- ❌ Code duplication increases
- ❌ Maintenance burden grows
- ❌ Inconsistent user experience
- ❌ Can't reuse across projects

### If We Refactor

**Benefits:**
- ✅ ACO import/delete work correctly
- ✅ Code reuse and DRY principles
- ✅ Consistent with Commerce patterns
- ✅ Generic and reusable
- ✅ Easier to maintain
- ✅ Better developer experience

**Cost:** 9-14 hours of work

**ROI:** High - enables ACO functionality, reduces long-term maintenance

---

## 🎯 Next Steps

### Priority Order

1. **Fix Critical Issues** (4-6 hours)
   - Get ACO scripts to load and run
   - Essential for basic functionality

2. **Apply DRY/Reusability** (3-5 hours)
   - Reduce duplication
   - Make generic and maintainable

3. **Polish and Document** (2-3 hours)
   - Consistent output
   - Clean code
   - Good documentation

### Decision Point

**Question for you:**
Do you want ACO functionality now, or should we:
- **Option 1:** Refactor ACO now (9-14 hours)
- **Option 2:** Focus on Commerce, do ACO later
- **Option 3:** Minimal fix to make ACO work (2-3 hours), full refactor later

---

## 📌 Conclusion

The ACO scripts need significant work to match the quality and reusability of the Commerce scripts. They currently:

- ❌ Don't load (broken imports)
- ❌ Missing required files
- ❌ Not generic or reusable
- ❌ High code duplication (likely)
- ❌ Inconsistent with Commerce patterns

**Recommendation:** Refactor ACO scripts to match Commerce improvements. The investment (9-14 hours) will pay off in:
- Working ACO functionality
- Consistent codebase
- Reduced maintenance
- Better reusability

**Status:** 🔴 **ACO scripts need refactoring before they can be used**

