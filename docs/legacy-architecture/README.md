# Legacy Architecture Documentation

This directory contains architecture documentation from the original `buildright-commerce` monorepo before it was split into the 3-repository architecture.

---

## Purpose

These documents provide:
- Historical context for architectural decisions
- Understanding of the original monorepo approach
- Rationale for the migration to 3 repositories
- Data flow documentation from the original system

---

## Documents

### Architecture Analysis

- **[DATA-FLOWS.md](./DATA-FLOWS.md)**
  - Original data flow documentation
  - Commerce ↔ ACO relationships
  - File requirements and transformations
  - **Note:** May reference old paths; updated version needed for 3-repo architecture

- **[SYSTEM-RECOMMENDATION-FOR-LOCKED-DEMO.md](./SYSTEM-RECOMMENDATION-FOR-LOCKED-DEMO.md)**
  - Recommendations for locked demo deployment strategy
  - Commit vs. gitignore decisions for generated artifacts
  - Historical context for current approach

---

## Why These Are "Legacy"

These documents were written when:
- All code lived in `buildright-commerce` monorepo
- Generation, data, and ingestion were mixed together
- BuildRight-specific code was in the same repo as generic tools

**The 3-repository architecture (December 2025) changed this:**
- **commerce-demo-generator** - Generic generation tool
- **buildright-data** - Project-specific data repository
- **commerce-demo-ingestion** - Generic ingestion tool

---

## Current Documentation

For up-to-date documentation, see:

### In This Repository
- **[../README.md](../../README.md)** - Main ingestion repository README
- **[../3-REPO-QUICK-START.md](../3-REPO-QUICK-START.md)** - Quick start guide
- **[../migration/](../migration/)** - 3-repo migration documentation

### In Other Repositories
- **[commerce-demo-generator/docs/](../../commerce-demo-generator/docs/)** - Generator technical docs
- **[buildright-data/README.md](../../buildright-data/README.md)** - Data repository guide

---

## Reading These Documents

When reading legacy architecture docs:
- ⚠️ File paths may be outdated (old monorepo structure)
- ⚠️ Some scripts mentioned may have been moved or refactored
- ⚠️ Concepts are still valid, but implementation has changed
- ✅ Architectural principles remain relevant
- ✅ Data flow concepts still apply

---

## Migration Timeline

| Date | Event |
|------|-------|
| Pre-Dec 2025 | Single `buildright-commerce` monorepo |
| Dec 15, 2025 | 3-repo architecture planned |
| Dec 16, 2025 | Repositories created and code migrated |
| Dec 16, 2025 | `buildright-commerce` deprecated |

---

**Status:** These documents are preserved for historical reference only.  
**For current work:** Use documentation in the 3 active repositories.

