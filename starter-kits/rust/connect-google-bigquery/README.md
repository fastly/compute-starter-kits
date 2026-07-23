# Google BigQuery Starter Kit for Rust

## About this starter

This Fastly Compute starter kit is to connect to Google's BigQuery. You can use Data Manipulation Language (DML) since this uses [`jobs.query` of bigquery API](https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query). The reason why this uses `jobs.query` to insert data rather than [streaming insert api](https://cloud.google.com/bigquery/docs/reference/rest/v2/tabledata/insertAll) is to allow the inserted data to be modified immediately.

## Configuration

Put your GCP project information in the `[bigquery]` section of the `src/config.toml` file. You will need [a service account](https://cloud.google.com/iam/docs/service-accounts) for your project to connect BigQuery.

## Security issues

Please see [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.
