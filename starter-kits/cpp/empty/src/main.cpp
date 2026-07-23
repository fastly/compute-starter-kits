#include <fastly/sdk.h>

int main() {
    fastly::Response::from_status(200)
        .send_to_client();
    return 0;
}
