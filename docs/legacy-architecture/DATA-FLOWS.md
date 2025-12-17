# Data Flows: Commerce ↔ ACO

Visual step-by-step flows for data generation and ingestion between Adobe Commerce and Adobe Commerce Optimizer (ACO).

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  buildright-commerce (Source of Truth)                          │
│  ├─ data/                  ← Human-friendly JSON configs        │
│  │  ├─ products/catalog.json    (161 templates → 281 SKUs)     │
│  │  ├─ attributes/*.json        (42 attributes)                 │
│  │  ├─ categories/*.json        (12 categories)                 │
│  │  └─ customers/*.json         (5 personas)                    │
│  └─ scripts/output/buildright-datapack/  ← Generated output     │
│     └─ data/accs/*.json         (ACCS format for Commerce)      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    npm run import:commerce
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Adobe Commerce (Catalog + Customers)                           │
│  ├─ 281 products                                                │
│  ├─ 42 product attributes                                       │
│  ├─ 12 categories                                               │
│  └─ 5 customer accounts                                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                     cd ../buildright-aco
                     npm run generate:all  (ACO-specific data)
                     npm run import        (ingest from Commerce)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  buildright-aco (ACO-Specific Features)                         │
│  ├─ data/buildright/                                            │
│  │  ├─ price-books.json     ← Generated (5 price books)        │
│  │  ├─ prices.json          ← Generated (1,405 price rules)    │
│  │  ├─ metadata.json        ← Copied from Commerce             │
│  │  ├─ products.json        ← Copied from Commerce             │
│  │  └─ variants.json        ← Copied from Commerce             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    Ingest to ACO Admin API
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Adobe Commerce Optimizer (Pricing + Search)                    │
│  ├─ Products (from Commerce)                                    │
│  ├─ Attributes (from Commerce)                                  │
│  ├─ 5 Price Books (persona-based)                               │
│  └─ 1,405 Price Rules (SKU + quantity tiers)                    │
└─────────────────────────────────────────────────────────────────┘
```

**Key Principle:** Commerce is the source of truth for catalog data. ACO adds persona-based pricing on top.

---

## Flow 1: Generate Commerce Datapack

```
JSON Configs (data/*.json)
  ↓ npm run generate
  
Generator (scripts/workflows/generate-datapack.js)
  │
  ├─ STEP 1: Load JSON Configs
  │  ↓ data/products/catalog.json        (161 templates)
  │  ↓ data/products/brands.json          (52 brands)
  │  ↓ data/attributes/*.json             (42 attributes)
  │  ↓ data/categories/category-tree.json (12 categories)
  │  ↓ data/customers/*.json              (5 personas)
  │
  ├─ STEP 2: Generate Simple Products
  │  ↓ scripts/products/generate.js
  │  ↓ Processes 146 simple product templates
  │  ↓ Enriches with brand-specific descriptions
  │  ↓ Returns: Array of 146 simple products
  │
  ├─ STEP 3: Generate Configurable Products + Variants
  │  ↓ scripts/products/generate-variants.js
  │  ↓ Processes 15 configurable templates
  │  ↓ Generates variants from dimension combinations
  │  ↓ Example: "4x4 Post" → 6 variants (3 lengths × 2 materials)
  │  ↓ Returns: 15 parents + 135 variants
  │
  ├─ STEP 4: Check for Duplicate SKUs
  │  ↓ Validates all 281 SKUs are unique
  │  ↓ Throws error if duplicates found
  │
  └─ STEP 5: Write ACCS Format Files
     ↓ scripts/output/buildright-datapack/data/accs/
     ↓   ├─ accs_products.json              (281 products)
     ↓   ├─ accs_product_attributes.json    (42 attributes)
     ↓   ├─ accs_attribute_sets.json        (1 set)
     ↓   ├─ accs_customer_groups.json       (5 groups)
     ↓   ├─ accs_customers.json             (5 accounts)
     ↓   └─ accs_stores.json                (1 store)
     
Output
  ✔ Datapack ready in scripts/output/buildright-datapack/
```

**Duration:** ~5 seconds  
**Output:** 7 ACCS JSON files + media structure  
**Committed to Git:** Yes (for locked demo deployment)

---

## Flow 2: Import Datapack to Commerce

```
Datapack (scripts/output/buildright-datapack/)
  ↓ npm run import:commerce
  
Commerce Import Orchestrator (scripts/import-all.js)
  │
  ├─ STEP 1: Test Connection
  │  ↓ scripts/shared/commerce-api.js
  │  ↓ GET /rest/V1/store/storeViews
  │  ↓ Validates COMMERCE_ADMIN_TOKEN
  │
  ├─ STEP 2: Import Attributes (42)
  │  ↓ scripts/attributes/import.js
  │  ↓ For each attribute in accs_product_attributes.json:
  │  ↓   POST /rest/V1/products/attributes
  │  ↓ Duration: ~8 seconds
  │  ↓ Progress: [████████████████████] 42/42
  │
  ├─ STEP 3: Import Categories (37)
  │  ↓ scripts/categories/import.js
  │  ↓ Creates "BuildRight Catalog" as root (parent_id: 1)
  │  ↓ Recursively creates children
  │  ↓ Duration: ~5 seconds
  │
  ├─ STEP 4: Import Products (281)
  │  ↓ scripts/products/import.js
  │  ↓ Batch size: 25, Concurrency: 5
  │  ↓ For each product:
  │  ↓   - Transform to Commerce API format
  │  ↓   - POST /rest/V1/products
  │  ↓   - Link to categories
  │  ↓ Duration: ~140 seconds
  │  ↓ Progress: [████████████████████] 281/281
  │
  ├─ STEP 5: Import Customers (5)
  │  ↓ scripts/customers/import.js
  │  ↓ Creates customer accounts with:
  │  ↓   - Customer group assignment
  │  ↓   - ACO catalog view ID (custom attribute)
  │  ↓   - ACO price book ID (custom attribute)
  │  ↓ Duration: ~3 seconds
  │
  └─ STEP 6: Import Images (34)
     ↓ scripts/images/import.js
     ↓ Brand-agnostic matching:
     ↓   - "ProFrame 4x4 Post - 8ft" → "4x4post8ft"
     ↓   - Matches product SKUs to image filenames
     ↓ Concurrency: 3, Batch delay: 200ms
     ↓ Duration: ~10 seconds

Adobe Commerce API
  ✔ 281 products available
  ✔ 42 attributes indexed
  ✔ 37 categories in "BuildRight Catalog"
  ✔ 5 customer accounts ready
```

**Total Duration:** ~3 minutes  
**HTTP Calls:** ~350 (batched and parallelized)  
**Idempotent:** Yes (can re-run safely)

---

## Flow 3: Generate ACO Pricing Data

```
Commerce Catalog (already populated)
  ↓ cd ../buildright-aco && npm run generate:all
  
ACO Data Generator (scripts/generate-all-parallel.js)
  │
  ├─ STEP 1: Generate Price Books
  │  ↓ scripts/generate-price-books.js
  │  ↓ Creates:
  │  ↓   - 1 Base: "US-Retail" (currency: USD)
  │  ↓   - 4 Tiers (parentId: US-Retail):
  │  ↓     • Production-Builder (15% off retail)
  │  ↓     • Trade-Professional (10% off retail)
  │  ↓     • Wholesale-Reseller (25% off retail)
  │  ↓     • Retail-Registered (5% off retail)
  │  ↓ Output: data/buildright/price-books.json
  │  ↓ Duration: ~0.5 seconds
  │
  └─ STEP 2: Generate Prices (1,405 rules)
     ↓ scripts/generate-prices.js
     ↓ For each of 281 SKUs:
     ↓   - Base retail price (from Commerce product)
     ↓   - Quantity tier prices:
     ↓     • 1-9: base price
     ↓     • 10-49: -5%
     ↓     • 50-99: -10%
     ↓     • 100+: -15%
     ↓ For each price book:
     ↓   - Apply customer tier discount
     ↓   - Create price entry with tiers
     ↓ Output: data/buildright/prices.json
     ↓ Duration: ~0.5 seconds

Output
  ✔ data/buildright/price-books.json (5 price books)
  ✔ data/buildright/prices.json (1,405 price rules)
```

**Total Duration:** ~1 second  
**Output:** 2 JSON files (ready for ACO ingestion)  
**Commerce Dependency:** Uses SKUs + base prices from Commerce

---

## Flow 4: Ingest Data to ACO

```
ACO Data Files (data/buildright/*.json)
  ↓ npm run import
  
ACO Ingest Orchestrator (scripts/ingest-all.js)
  │
  ├─ STEP 1: Ingest Metadata (42 attributes)
  │  ↓ scripts/ingest-metadata.js
  │  ↓ Reads: data/buildright/metadata.json (from Commerce)
  │  ↓ For each attribute:
  │  ↓   POST ACO Admin API: createAttribute
  │  ↓   {
  │  ↓     attributeId: "br_brand",
  │  ↓     label: "Brand",
  │  ↓     dataType: "TEXT",
  │  ↓     visibility: ["PRODUCT_DETAIL", "PRODUCT_LISTING"],
  │  ↓     searchWeight: 3
  │  ↓   }
  │  ↓ Batch size: 10, Duration: ~8 seconds
  │
  ├─ STEP 2: Ingest Products (281)
  │  ↓ scripts/ingest-products.js
  │  ↓ Reads: data/buildright/products.json (from Commerce)
  │  ↓ For each simple product:
  │  ↓   POST ACO Admin API: createProduct
  │  ↓   {
  │  ↓     sku: "LBR-001",
  │  ↓     name: "ProFrame 2x4 Stud - 8ft",
  │  ↓     attributes: { br_brand: "ProFrame", ... }
  │  ↓   }
  │  ↓ Batch size: 50, Duration: ~20 seconds
  │
  ├─ STEP 3: Ingest Variants (135)
  │  ↓ scripts/ingest-variants.js
  │  ↓ Reads: data/buildright/variants.json (from Commerce)
  │  ↓ For each variant:
  │  ↓   POST ACO Admin API: createProductVariant
  │  ↓   {
  │  ↓     parentSku: "CON-001",
  │  ↓     sku: "CON-001-V1",
  │  ↓     selections: { br_length: "8ft", br_material: "Treated Pine" }
  │  ↓   }
  │  ↓ Batch size: 50, Duration: ~15 seconds
  │
  ├─ STEP 4: Ingest Price Books (5)
  │  ↓ scripts/ingest-price-books.js
  │  ↓ Reads: data/buildright/price-books.json (ACO-generated)
  │  ↓ For base price book:
  │  ↓   POST ACO Admin API: createBasePriceBook
  │  ↓   { priceBookId: "US-Retail", currency: "USD" }
  │  ↓ For tier price books:
  │  ↓   POST ACO Admin API: createCustomerTierPriceBook
  │  ↓   { priceBookId: "Production-Builder", parentId: "US-Retail" }
  │  ↓ Duration: ~2 seconds
  │
  └─ STEP 5: Ingest Prices (1,405 rules)
     ↓ scripts/ingest-prices.js
     ↓ Reads: data/buildright/prices.json (ACO-generated)
     ↓ For each price rule:
     ↓   POST ACO Admin API: createPrice
     ↓   {
     ↓     priceBookId: "US-Retail",
     ↓     sku: "LBR-001",
     ↓     price: { value: 8.99 },
     ↓     quantityTiers: [
     ↓       { minimumQuantity: 10, price: { value: 8.54 } },
     ↓       { minimumQuantity: 50, price: { value: 8.09 } },
     ↓       { minimumQuantity: 100, price: { value: 7.64 } }
     ↓     ]
     ↓   }
     ↓ Batch size: 100, Concurrency: 5
     ↓ Duration: ~40 seconds

Adobe Commerce Optimizer API
  ✔ 281 products indexed
  ✔ 42 attributes configured
  ✔ 5 price books active
  ✔ 1,405 price rules applied
  ✔ Ready for catalog queries
```

**Total Duration:** ~90 seconds  
**HTTP Calls:** ~500 (batched to ACO Admin GraphQL API)  
**Idempotent:** Yes (smart detection of existing data)

---

## Flow 5: Transform Commerce to ACO Format

Used to convert Commerce ACCS format to ACO ingestion format.

```
Commerce Datapack (scripts/output/buildright-datapack/)
  ↓ npm run transform:aco
  
Transformer (scripts/workflows/transform-for-aco.js)
  │
  ├─ STEP 1: Load Commerce ACCS Files
  │  ↓ scripts/output/buildright-datapack/data/accs/
  │  ↓   ├─ accs_products.json (281 products)
  │  ↓   └─ accs_product_attributes.json (42 attributes)
  │  ↓ Read ACCS wrapper format
  │
  ├─ STEP 2: Separate Product Types
  │  ↓ Filter products by type:
  │  ↓   - Simple products (no parent_sku): 146 products
  │  ↓   - Variants (has parent_sku): 135 variants
  │  ↓   - Configurable parents: excluded (ACO doesn't use them)
  │
  ├─ STEP 3: Transform Metadata (42 attributes)
  │  ↓ For each Commerce attribute:
  │  ↓   - attributeCode → attributeId
  │  ↓   - frontendLabel → label
  │  ↓   - frontendInput → type
  │  ↓   - Add dataType (TEXT, DECIMAL, BOOLEAN, DATE)
  │  ↓   - isSearchable/isFilterable → visibility array
  │  ↓   - Calculate searchWeight (1-5)
  │  ↓   - Transform options: strings → objects
  │
  ├─ STEP 4: Transform Products (146 simple)
  │  ↓ For each simple product:
  │  ↓   - Extract sku, name, description, url_key → slug
  │  ↓   - visibility (number) → visibleIn array ["CATALOG", "SEARCH"]
  │  ↓   - Flatten br_* attributes:
  │  ↓     FROM: { br_brand: "ProFrame" }
  │  ↓     TO: { attributes: [{ code: "br_brand", values: ["ProFrame"] }] }
  │  ↓   - Add price and weight as attributes
  │  ↓   - Remove categories (ACO doesn't use them)
  │
  └─ STEP 5: Transform Variants (135 variants)
     ↓ For each variant:
     ↓   - parent_sku → parentSku (camelCase)
     ↓   - Extract configurable_variations → selections object
     ↓     FROM: "br_length=8ft,br_material=Treated Pine"
     ↓     TO: { selections: { br_length: "8ft", br_material: "Treated Pine" } }
     ↓   - Transform attributes same as products
     ↓   - Generate slug from name

Output (../buildright-aco/output/buildright/)
  ✔ metadata.json (42 attributes in ACO format)
  ✔ products.json (146 simple products in ACO format)
  ✔ variants.json (135 variants in ACO format)
```

**Duration:** ~1 second  
**Input:** Commerce ACCS format (flat attributes, wrapper objects)  
**Output:** ACO format (attribute arrays, no wrappers)  
**Location:** `scripts/workflows/transform-for-aco.js` (214 lines)

**Format Transformation Example:**

Commerce ACCS:
```json
{
  "sku": "LBR-001",
  "name": "2x4 Stud",
  "price": "9.22",
  "visibility": 4,
  "br_brand": "ProFrame"
}
```

ACO Format:
```json
{
  "sku": "LBR-001",
  "name": "2x4 Stud",
  "visibleIn": ["CATALOG", "SEARCH"],
  "attributes": [
    { "code": "price", "values": ["9.22"] },
    { "code": "br_brand", "values": ["ProFrame"] }
  ]
}
```

---

## Flow 6: Metadata Transformation (Optional)

Used in `npm run lifecycle` for full regeneration from ACO metadata source.

```
ACO Metadata (buildright-aco/data/buildright/metadata.json)
  ↓ npm run transform:metadata
  
Metadata Transformer (scripts/workflows/transform-metadata.js)
  │
  ├─ STEP 1: Read ACO Metadata
  │  ↓ Reads: buildright-aco/data/buildright/metadata.json
  │  ↓ {
  │  ↓   attributeId: "br_brand",
  │  ↓   label: "Brand",
  │  ↓   type: "select",
  │  ↓   options: [...]
  │  ↓ }
  │
  ├─ STEP 2: Transform Types
  │  ↓ ACO → Commerce type mapping:
  │  ↓   - "text" → "text"
  │  ↓   - "select" → "select"
  │  ↓   - "number" → "text" (Commerce has no number type)
  │  ↓   - "boolean" → "boolean"
  │
  ├─ STEP 3: Determine Commerce Flags
  │  ↓ Sets based on attribute importance:
  │  ↓   - isSearchable: key attributes only
  │  ↓   - isFilterable: category, brand, tier, phase
  │  ↓   - isComparable: product differentiators
  │  ↓   - isVisibleOnFront: all attributes
  │
  └─ STEP 4: Write Commerce Attributes
     ↓ Output: scripts/attributes/attribute-definitions.js
     ↓ export const PRODUCT_ATTRIBUTES = [...]
     ↓ Duration: <1 second

Output
  ✔ Commerce attribute definitions updated
  ✔ Ready for datapack generation
```

**Use Case:** When expanding demo with new attributes  
**Frequency:** Rare (only when attribute schema changes)  
**Note:** Currently bypassed in locked demo workflow (attributes in JSON)

---

## Summary: Data Dependencies

### Commerce → ACO (One-Way Flow with Transformation)
```
Commerce Datapack (ACCS format)
  ↓ transform-for-aco.js (scripts/workflows/)
ACO Format Files
  ├─ metadata.json (42 attributes transformed)
  ├─ products.json (146 simple transformed)
  └─ variants.json (135 variants transformed)
```

**Key Point:** ACO does NOT read from Commerce API. Instead, Commerce datapack is transformed to ACO format offline.

### ACO-Specific Data (Generated in ACO Repo)
```
Price Books (5) → Generated from persona definitions
Prices (1,405) → Generated from Commerce SKUs + price tiers
```

### Key Files by Repository

**buildright-commerce:**
- **Source:** `data/*.json` (human-editable configs)
- **Generated:** `scripts/output/buildright-datapack/` (ACCS format)
- **Committed:** Yes (datapack is committed for deployment)

**buildright-aco:**
- **Source:** `data/buildright/metadata.json` (from Commerce)
- **Generated:** `data/buildright/price-books.json`, `prices.json`
- **Not Committed:** Generated files (regenerated on demand)

---

## Deployment Workflows

### Frequent: Deploy Committed Datapack
```bash
# In buildright-commerce
npm run import:all
```
- ✅ Deploys committed datapack to Commerce
- ✅ Ingests Commerce data to ACO
- ✅ Duration: ~4 minutes

### Rare: Expand Demo
```bash
# 1. Edit JSON configs
vim data/products/catalog.json

# 2. Regenerate datapack
npm run generate

# 3. Commit updated datapack
git add scripts/output/buildright-datapack/
git commit -m "feat: expand catalog"
```

### Very Rare: Full Regeneration
```bash
npm run lifecycle
```
- ✅ Generates ACO pricing → Transforms metadata → Generates Commerce datapack → Imports all
- ✅ Duration: ~5 minutes

---

## Related Docs

- **Deployment Workflow**: `DEPLOYMENT-WORKFLOW-2025-12-15.md` - Locked demo strategy
- **System Analysis**: `SYSTEM-ANALYSIS-USEFUL-OR-OVERENGINEERED.md` - Architecture rationale
- **JSON Configuration**: `JSON-CONFIGURATION-PHASE3-2025-12-15.md` - Human-friendly configs

