<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

> **⚠️ SCHEMA UPDATE (December 2024)**
> 
> The ACO Category schema has been updated in v1.0.0 of the Data Ingestion API. The fields `code`, `description`, `active`, and `parentId` are **no longer supported**. Hierarchy is now represented via the `slug` field using a path format (e.g., `"parent/child/grandchild"`).
> 
> See the [JSON Payload Example](#json-payload-example) section below for the updated schema.

## Summary

Based on current Adobe Commerce Optimizer documentation, here's what I found:

### ✓ Yes, ACO Can Handle Categories

ACO's Data Ingestion API **does support categories** with full hierarchical structures using slug-based paths. This is fully documented in the Categories resource, just like products and prices.

### ✗ But ACO Lacks Category Visualization

Here's your constraint: **ACO has no category management UI or dashboard**. Categories can only be managed via API. This is a real limitation when you need to demonstrate or adjust category structures in real-time.

***

## My Recommendation: **Dual Ownership Approach** (Approach 3)

Given your demo requirements and architectural goals, I recommend:

1. **Adobe Commerce owns the UX** — Use AC Admin for intuitive, visual category management
2. **ACO owns the delivery** — Categories sync from AC → ACO via transformation layer
3. **Flexibility valve** — The transformation service between them is where you add overrides, policies, or channel-specific modifications

### Why This Balances Your Concerns

**Not Rigid Because:**

- The transformation layer is your control point for customizations
- ACO categories are truly the source for storefronts (headless principle)
- You can evolve this later to ACO-first if needed
- You maintain the ability to decouple completely

**Great for Demos:**

- Show category changes in AC Admin (familiar, visual)
- Demonstrate the sync happening
- Verify categories working in ACO storefronts
- Tells the story: **"Commerce handles the UX layer, ACO handles delivery at scale"**

**Production Sound:**

- Not tightly coupled — if you add other data sources or channels, ACO becomes the aggregation layer
- Clear separation of concerns
- Aligns with composable commerce patterns

***

## The Trade-off

- **Pure composability** (ACO owns everything) sacrifices the demo advantage and requires API-first category management
- **AC owns everything** works now but feels locked in architecturally
- **Dual with sync** gives you both: architectural flexibility AND practical demo value

Which of these resonates most with your use case? What's your audience for this demo? That'll help refine which approach works best for your specific situation.
<span style="display:none">[^1_1][^1_10][^1_11][^1_12][^1_13][^1_14][^1_15][^1_16][^1_17][^1_18][^1_19][^1_2][^1_20][^1_21][^1_22][^1_23][^1_24][^1_25][^1_26][^1_27][^1_28][^1_29][^1_3][^1_30][^1_31][^1_32][^1_33][^1_34][^1_35][^1_36][^1_4][^1_5][^1_6][^1_7][^1_8][^1_9]</span>

<div align="center">⁂</div>

[^1_1]: https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/categories/create/categories-search-engine-optimization

[^1_2]: https://michaelskenny.com/points-of-view/field-guide-to-effective-aco-management-part-one/

[^1_3]: https://developer.adobe.com/commerce/services/optimizer/data-ingestion/

[^1_4]: https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/categories/categories

[^1_5]: https://www.thoroughcare.net/blog/accountable-care-organization-model

[^1_6]: https://developer.adobe.com/commerce/services/optimizer/data-ingestion/using-the-api/

[^1_7]: https://experienceleague.adobe.com/en/docs/commerce/optimizer/setup/catalog-view

[^1_8]: https://carejourney.com/navigate-the-complexities-of-aco-strategy-with-data-driven-insights/

[^1_9]: https://developer.adobe.com/commerce/services/reference/rest/

[^1_10]: https://experienceleague.adobe.com/en/docs/commerce/optimizer/manage-results/opportunities

[^1_11]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6312742/

[^1_12]: https://experienceleague.adobe.com/en/docs/commerce-learn/tutorials/adobe-commerce-optimizer/ingest-sample-data

[^1_13]: https://helpx.adobe.com/legal/product-descriptions/adobe-commerce-optimizer.html

[^1_14]: https://www.cms.gov/medicare/medicare-fee-for-service-payment/sharedsavingsprogram/downloads/aco-participant-list-agreement.pdf

[^1_15]: https://experienceleague.adobe.com/en/docs/experience-platform/ingestion/home

[^1_16]: https://experienceleague.adobe.com/en/docs/commerce/optimizer/boundaries-limits

[^1_17]: https://www.mathematica.org/download-media?MediaItemId={63D325C5-B6C3-4B4A-B59A-5A378ADA32D5}

[^1_18]: https://experienceleague.adobe.com/en/docs/commerce/data-connection/fundamentals/data-ingestion

[^1_19]: https://business.adobe.com/products/commerce/commerce-optimizer.html

[^1_20]: https://www.milliman.com/en/products/aco-care-management-impact-model

[^1_21]: https://experienceleague.adobe.com/en/docs/journey-optimizer-b2b/user/dashboards/intelligent-dashboard

[^1_22]: https://help.sap.com/docs/categories/sap-ariba-category-management-administration-guide/about-manage-taxonomy-page

[^1_23]: https://pmc.ncbi.nlm.nih.gov/articles/PMC4254130/

[^1_24]: https://experienceleague.adobe.com/en/docs/commerce-learn/tutorials/mbi/reports-and-dashboards

[^1_25]: https://www.opm.gov/policy-data-oversight/classification-qualifications/classifying-general-schedule-positions/standards/1100/gs1102.pdf

[^1_26]: https://experienceleague.adobe.com/en/docs/experience-platform/ingestion/batch/getting-started

[^1_27]: https://business.adobe.com/products/commerce.html

[^1_28]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6052017/

[^1_29]: https://github.com/adobe-commerce/aco-sample-catalog-data-ingestion

[^1_30]: https://experienceleaguecommunities.adobe.com/t5/adobe-experience-platform-blogs/introducing-data-distiller-dashboards-2-0/ba-p/719696

[^1_31]: https://www.cms.gov/files/document/aco-reach-py25-fin-op-ovw.pdf

[^1_32]: https://docs.aws.amazon.com/sdk-for-sap-abap/v1/api/latest/aco/index.html

[^1_33]: https://experienceleague.adobe.com/en/docs/commerce-admin/config/catalog/visual-merchandiser

[^1_34]: https://choir.berkeley.edu/sites/default/files/comfort_nsra-2016_organizational-correlates-of-aco-performance.pdf

[^1_35]: https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/machine-learning-operations-v2

[^1_36]: https://experienceleaguecommunities.adobe.com/t5/adobe-analytics-ideas/bring-the-journey-canvas-visualization-from-cja-to-adobe/idi-p/740142


---

# How are categories ingested into ACO? Does the ACO SDK provide tools for this?

Yes, categories are ingested via the **Data Ingestion API**, but there is a critical distinction between what the API supports and what the current SDK helper methods explicitly cover.

### 1. How Categories Are Ingested

Categories are ingested as a distinct resource using the Data Ingestion API. Unlike attributes (which are metadata), categories have their own endpoint because they possess hierarchy (slug-based paths).

* **API Endpoint:** `POST /v1/catalog/categories`
* **Method:** REST API (Bulk ingestion supported)
* **Hierarchy Handling:** You define the structure using `parentCategory` references or slug paths.


#### JSON Payload Example

**⚠️ UPDATED SCHEMA (v1.0.0 - December 2024)**

Based on the current ACO Data Ingestion API OpenAPI schema, a category payload looks like this:

```json
[
  {
    "slug": "men",
    "source": { "locale": "en-US" },
    "name": "Men's Clothing"
  },
  {
    "slug": "men/shirts",
    "source": { "locale": "en-US" },
    "name": "Shirts"
  },
  {
    "slug": "men/shirts/casual",
    "source": { "locale": "en-US" },
    "name": "Casual Shirts"
  }
]
```

**Required Fields:**
- `slug` (string) - Hierarchical path using forward slashes (e.g., "parent/child/grandchild")
- `source` (object) - Must contain `locale` (e.g., "en-US")
- `name` (string) - Display name for the category

**Optional Fields:**
- `families` (array of strings) - Product family identifiers for enhanced organization

**❌ REMOVED from Schema (No Longer Supported):**
- `code` - Use `slug` instead
- `description` - Not supported in v1.0.0
- `active` - Not supported in v1.0.0
- `parentId` - Hierarchy is now represented via the `slug` path

> **Note:** The `slug` path is crucial for establishing the tree structure. Parent-child relationships are defined by the hierarchical path format (e.g., "men/clothing/pants").

### 2. Does the SDK Provide Tools?

**Partially.**

* **The Limitation:** As of the current documentation for the `@adobe-commerce/aco-ts-sdk`, the high-level helper methods explicitly list `createProducts`, `createProductMetadata`, `createPriceBooks`, and `createPrices`. **`createCategories` is often missing from the top-level README examples**, which suggests it may not have a dedicated wrapper function in the version you are using.
* **The Workaround:** Since the SDK allows you to access the underlying authenticated `client` or `axios` instance (or provides a generic `request` method), you can call the `/categories` endpoint using the SDK's authentication but manually passing the payload.


#### How to check your specific SDK version:

Look in your `node_modules/@adobe-commerce/aco-ts-sdk/dist/types.ts` file.

* **If you see `createCategories`:** You can use it just like `createProducts`.
* **If you don't:** You will need to use a raw request:

```typescript
// If the helper is missing, use the client's generic request capability
await client.post('/v1/catalog/categories', [
  {
    code: 'new-category',
    source: { locale: 'en-US' },
    name: 'New Category',
    // ... other fields
  }
]);
```


### 3. Critical Integration Detail: Linking Products

Simply creating categories isn't enough; you must link products to them.
In the **Product Ingestion** payload, you will likely need to reference the category codes.

```typescript
const product = {
  sku: "TEST-SKU-001",
  // ... other fields
  categoryCodes: ["mens-shirts", "summer-sale"] // Links product to the ingested categories
};
```


### Recommendation

Since you are likely building a demo or a sync integration:

1. **Check the SDK types** first. If `createCategories` is there, use it.
2. **If not, build a simple wrapper** around the raw API call using the SDK's auth.
3. **Ingest Categories First:** Always ingest your category tree *before* ingesting products to ensure the keys exist for linkage.
<span style="display:none">[^2_1][^2_10][^2_11][^2_12][^2_13][^2_14][^2_15][^2_16][^2_17][^2_18][^2_19][^2_2][^2_20][^2_21][^2_22][^2_23][^2_24][^2_25][^2_26][^2_27][^2_28][^2_29][^2_3][^2_30][^2_31][^2_32][^2_4][^2_5][^2_6][^2_7][^2_8][^2_9]</span>

<div align="center">⁂</div>

[^2_1]: https://developer.adobe.com/commerce/services/optimizer/data-ingestion/

[^2_2]: https://developer.adobe.com/commerce/services/optimizer/

[^2_3]: https://experienceleague.adobe.com/en/docs/commerce/optimizer/setup/catalog-layer

[^2_4]: https://developer.adobe.com/commerce/services/optimizer/data-ingestion/using-the-api/

[^2_5]: https://github.com/adobe-commerce/aco-ts-sdk

[^2_6]: https://developer.adobe.com/commerce/services/optimizer/merchandising-services/using-the-api/

[^2_7]: https://experienceleague.adobe.com/en/docs/project-aim-demo/ingestion/batch/getting-started

[^2_8]: https://business.adobe.com/products/commerce/commerce-optimizer.html

[^2_9]: https://experienceleague.adobe.com/en/docs/journeys/using/events-journeys/defining-the-payload-fields

[^2_10]: https://developer.adobe.com/commerce/services/optimizer/data-ingestion/api-testing/

[^2_11]: https://experienceleague.adobe.com/en/docs/commerce/optimizer/boundaries-limits

[^2_12]: https://experienceleague.adobe.com/en/docs/experience-platform/ingestion/batch/overview

[^2_13]: https://helpx.adobe.com/legal/product-descriptions/adobe-commerce-optimizer.html

[^2_14]: https://experienceleague.adobe.com/en/docs/commerce-learn/tutorials/adobe-commerce-optimizer/ingest-sample-data

[^2_15]: https://developer.adobe.com/commerce/services/reference/rest/

[^2_16]: https://experienceleague.adobe.com/en/docs/experience-platform/ingestion/batch/getting-started

[^2_17]: https://experienceleague.adobe.com/en/docs/commerce/optimizer/get-started

[^2_18]: https://github.com/adobe-commerce/aco-sample-catalog-data-ingestion

[^2_19]: https://developer.adobe.com/commerce/services/optimizer/admin/using-the-api/

[^2_20]: https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/categories/create/category-create

[^2_21]: https://experienceleague.adobe.com/en/docs/experience-platform/sources/api-tutorials/collect/database-nosql

[^2_22]: https://experienceleague.adobe.com/en/docs/commerce/optimizer/setup/catalog-view

[^2_23]: https://experienceleague.adobe.com/en/docs/commerce-learn/tutorials/catalog/category-create

[^2_24]: https://developer.adobe.com/commerce/services/optimizer/ccdm-use-case/

[^2_25]: https://experienceleague.adobe.com/en/docs/commerce/optimizer/merchandising/facets/overview

[^2_26]: https://experienceleague.adobe.com/en/docs/commerce-admin/catalog/categories/categories

[^2_27]: https://experienceleague.adobe.com/en/docs/experience-platform/sources/api-tutorials/collect/ecommerce

[^2_28]: https://experienceleague.adobe.com/en/docs/commerce/optimizer/overview

[^2_29]: https://developer.adobe.com/commerce/webapi/rest/b2b/shared-cat-product-assign/

[^2_30]: https://experienceleague.adobe.com/en/docs/commerce-operations/implementation-playbook/glossary

[^2_31]: https://www.npmjs.com/package/@adobe-commerce/aco-ts-sdk

[^2_32]: https://raw.githubusercontent.com/AdobeDocs/commerce-services/refs/heads/main/static/rest/data-ingestion-schema-v1.yaml

