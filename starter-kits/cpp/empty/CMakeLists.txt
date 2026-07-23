# Sets the minimum version of CMake required for modern features like FetchContent
cmake_minimum_required(VERSION 3.25)
project(fastly_wasi_app)

# Ensure the WASI SDK is being used; without this, CMake might default to the native compiler
if("${WASI_SDK_PREFIX}" STREQUAL "")
    message(FATAL_ERROR "You must supply a CMAKE_TOOLCHAIN_FILE argument to CMake, pointing to the wasi-sdk-p1.cmake file in your WASI SDK installation.")
endif()

# Dependencies

# Fastly C++ SDK
include(FetchContent)
FetchContent_Declare(
        fastly_sdk
        URL https://github.com/fastly/compute-sdk-cpp/releases/download/v0.6.0/fastly-cpp-v0.6.0.tar.gz
        DOWNLOAD_EXTRACT_TIMESTAMP NEW
        SYSTEM
)
FetchContent_MakeAvailable(fastly_sdk)
find_package(fastly REQUIRED PATHS ${fastly_sdk_SOURCE_DIR} NO_DEFAULT_PATH)

# Build the app, include any additional source files here
add_executable(main
        src/main.cpp
)
target_include_directories(main PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

# Optimization: Link-Time Optimization (LTO) helps reduce Wasm binary size and improve performance
option(ENABLE_LTO "Enable cross language linking time optimization" ON)
if(ENABLE_LTO)
    include(CheckIPOSupported)
    check_ipo_supported(RESULT supported OUTPUT error)
    if(supported)
        message(STATUS "IPO / LTO enabled")
        # Tells the compiler to optimize across different translation units
        set_target_properties(main PROPERTIES INTERPROCEDURAL_OPTIMIZATION TRUE)
        # Force the use of the LLVM Linker (lld), which is required for Wasm LTO
        target_link_options(main PRIVATE -fuse-ld=lld)
    else()
        message(STATUS "IPO / LTO not supported: <${error}>")
    endif()
endif()

# Compiler Settings: Enable strict warnings (-Wall -Wextra) and treat them as errors (-Werror)
# -Wno-c23-extensions to enable C23 extensions such as #embed
# -fno-exceptions is critical for Wasm as it doesn't support C++ exceptions natively yet
target_compile_options(main PRIVATE -Wall -Wextra -Werror -fno-exceptions -Wno-c23-extensions)

# Set the C++ standard to C++20 for modern features like Move Semantics and Concepts
target_compile_features(main PRIVATE cxx_std_20)

#target_compile_features(main PRIVATE -Wc23-extensions)
#add_compile_options(-Wno-c23-extensions)
# Change the output file extension from a native executable format to .wasm
set_target_properties(main PROPERTIES SUFFIX .wasm)

# Link our application
target_link_libraries(main PRIVATE
        fastly::fastly
)
