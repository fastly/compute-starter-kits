use fastly::kv_store::KVStoreError;
use fastly::KVStore;
use fastly::{Error, Request, Response};

#[fastly::main]
fn main(req: Request) -> Result<Response, Error> {
    // Log out which version of the Fastly Service is responding to this request.
    // This is useful to know when debugging.
    if let Ok(fastly_service_version) = std::env::var("FASTLY_SERVICE_VERSION") {
        println!("FASTLY_SERVICE_VERSION: {}", fastly_service_version);
    }

    /*
        Construct a KVStore instance which is connected to the KV Store named `my-store`

        [Documentation for the KVStore open method can be found here](https://docs.rs/fastly/latest/fastly/struct.KVStore.html#method.open)
    */
    let store = KVStore::open("my-store").map(|store| store.expect("KVStore exists"))?;

    let path = req.get_path();
    if path == "/readme" {
        match store.lookup("readme") {
            Ok(mut l) => Ok(Response::from_body(l.take_body())),
            Err(KVStoreError::ItemNotFound) => {
                Ok(Response::from_body("Not Found").with_status(404))
            }
            Err(_e) => Ok(Response::from_body("Lookup Error").with_status(503)),
        }
    } else {
        /*
        Adds or updates the key `hello` in the KV Store with the value `world`.

        Note: KV stores are eventually consistent, this means that the updated value associated
        with the key may not be available to read from all edge locations immediately and some edge
        locations may continue returning the previous value associated with the key.

        [Documentation for the insert method can be found here](https://docs.rs/fastly/latest/fastly/struct.KVStore.html#method.insert)
        */
        store.insert("hello", "world")?;

        /*
        Retrieve the value associated with the key `hello` in the KV Store.
        If the key does not exist, then `None` is returned.
        If the key does exist, then an `Some<Body>` is returned.

        [Documentation for the lookup method can be found here](https://docs.rs/fastly/latest/fastly/struct.KVStore.html#method.lookup)
        */
        match store.lookup("hello") {
            Ok(mut l) => Ok(Response::from_body(l.take_body())),
            Err(KVStoreError::ItemNotFound) => {
                Ok(Response::from_body("Not Found").with_status(404))
            }
            Err(_e) => Ok(Response::from_body("Lookup Error").with_status(503)),
        }
    }
}
