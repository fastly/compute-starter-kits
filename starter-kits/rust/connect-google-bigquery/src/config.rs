use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub gcp: GcpConfiguration,
    pub bigquery: BqConfiguration,
}

#[derive(Debug, Deserialize)]
pub struct BqConfiguration {
    pub service_account_email: String,
    pub service_account_key: String,
    pub scope: String,
    pub projectid: String,
    pub dataset_tableid: String,
}

#[derive(Debug, Deserialize)]
pub struct GcpConfiguration {
    pub aud: String,
    pub grant_type: String,
}

impl Config {
    pub fn load() -> Self {
        let config: Config = toml::from_str(include_str!("config.toml")).unwrap();
        let gcp: GcpConfiguration = config.gcp;
        let bigquery: BqConfiguration = config.bigquery;
        Self { gcp, bigquery }
    }
}
