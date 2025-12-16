# Commerce Demo Ingestion

Generic ingestion scripts for importing demo data into Adobe Commerce and Adobe Commerce Optimizer (ACO).

## Overview

This repository contains all the tooling needed to import generated datapacks into target Commerce and ACO systems. It's designed to be project-agnostic, reading data from separate data repositories.

## Architecture

```
buildright-data (or any data repo)
    ↓ generated datapacks
commerce-demo-ingestion (this repo)
    ↓ imports via APIs
Adobe Commerce / ACO
```

## Features

### Commerce Ingestion
- Products (simple & configurable)
- Categories and category hierarchy
- Product attributes and customer attributes
- Stores (website, store group, store view)
- Customer groups and demo customers
- Product images with role assignment
- Idempotent imports (can re-run safely)
- Smart detection and deletion

### ACO Ingestion
- Product catalog
- Variants
- Metadata and attributes
- Bulk operations with progress tracking

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- Access to Adobe Commerce instance (admin credentials)
- Access to ACO instance (API credentials)
- A data repository with generated datapacks (e.g., `buildright-data`)

### Installation

```bash
npm install
```

### Configuration

1. Copy `.env.example` to `.env`
2. Configure your Commerce and ACO credentials
3. Set `DATA_REPO_PATH` to point to your data repository

```bash
cp .env.example .env
```

Edit `.env`:
```env
DATA_REPO_PATH=../buildright-data
COMMERCE_BASE_URL=https://your-instance.com
COMMERCE_ADMIN_USERNAME=admin
COMMERCE_ADMIN_PASSWORD=your-password
ACO_API_KEY=your-key
```

## Usage

### Import to Commerce

Import all Commerce data:
```bash
npm run import:commerce
```

This will import in order:
1. Stores (website, store group, store view)
2. Customer groups
3. Product attributes
4. Categories
5. Products
6. Product images
7. Customer attributes
8. Demo customers

### Delete from Commerce

Delete all project-specific data from Commerce:
```bash
npm run delete:commerce
```

This performs a clean deletion in reverse dependency order.

### Import to ACO

Import data to ACO:
```bash
npm run import:aco
```

### Delete from ACO

Delete project data from ACO:
```bash
npm run delete:aco
```

## Using with Different Data Repositories

Point to different data repositories:

```bash
DATA_REPO_PATH=../citisignal-data npm run import:commerce
```

Or update your `.env` file.

## Project Structure

```
commerce-demo-ingestion/
├── commerce/                    # Commerce ingestion scripts
│   ├── import-all.js           # Main Commerce import orchestrator
│   ├── delete-all.js           # Main Commerce delete orchestrator
│   ├── products/
│   │   └── import.js           # Product importer
│   ├── categories/
│   │   └── import.js           # Category importer
│   ├── attributes/
│   │   ├── import.js           # Product attributes
│   │   └── import-customer-attributes.js
│   ├── customers/
│   │   ├── import.js           # Customer importer
│   │   └── import-groups.js    # Customer groups
│   ├── stores/
│   │   └── import.js           # Store structure
│   └── images/
│       └── import.js           # Product images
├── aco/                        # ACO ingestion scripts
│   ├── import.js               # ACO import orchestrator
│   └── delete.js               # ACO delete orchestrator
└── shared/                     # Shared utilities
    ├── base-importer.js        # Base importer class
    ├── commerce-api.js         # Commerce REST API client
    ├── smart-detector.js       # Intelligent data detection
    ├── state-tracker.js        # Import state management
    └── format.js               # CLI formatting utilities
```

## Features

### Idempotent Imports

All import scripts are idempotent - you can run them multiple times safely:

- Existing data is detected and skipped
- Only new data is created
- State is tracked for efficiency
- No duplicate data

### Smart Detection

The smart detector finds project-specific data using multiple strategies:

- Attribute prefix matching (e.g., `br_*`)
- Category pattern matching
- Customer group patterns
- Website scope filtering

### Progress Tracking

Visual progress bars and status updates for all operations:

- Real-time progress percentages
- Estimated time remaining
- Detailed success/failure reporting
- Colored output for clarity

### Error Handling

Robust error handling with:

- Automatic retries for transient failures
- Detailed error messages
- Partial success tracking
- Graceful degradation

## Advanced Usage

### Dry Run Mode

Test deletion without actually deleting:

```bash
DRY_RUN=true npm run delete:commerce
```

### Custom Concurrency

Adjust parallel processing:

```bash
CONCURRENCY=10 npm run import:commerce
```

### Custom Batch Size

Adjust batch sizes for processing:

```bash
BATCH_SIZE=100 npm run import:commerce
```

## Troubleshooting

### Commerce Connection Issues

- Verify `COMMERCE_BASE_URL` is correct
- Check admin credentials
- Ensure Commerce REST API is enabled
- Verify admin user has API permissions

### ACO Connection Issues

- Verify `ACO_API_KEY` is valid
- Check tenant and environment IDs
- Ensure API key has necessary permissions

### Import Failures

- Check Commerce logs for detailed errors
- Verify datapack format is correct
- Ensure all required fields are present
- Check for network/connectivity issues

### State Tracker Issues

If imports are skipping everything:

```bash
rm -rf .{project-identifier}-state/
npm run import:commerce
```

## Related Repositories

- **commerce-demo-generator**: Generates the datapacks this tool imports
- **buildright-data**: Contains BuildRight demo data and generated datapacks
- **citisignal-data**: Contains CitiSignal demo data (if applicable)

## License

MIT

