cmake_minimum_required(VERSION 3.22.1)
project(paperback_bridge C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# --- QuickJS-NG 0.17.0 (vendored, MIT) -------------------------------------
add_library(qjs STATIC
        quickjs/quickjs.c
        quickjs/dtoa.c
        quickjs/libregexp.c
        quickjs/libunicode.c
)

target_include_directories(qjs PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/quickjs)
target_compile_definitions(qjs PRIVATE _GNU_SOURCE)
target_compile_options(qjs PRIVATE -fno-strict-aliasing)

# --- Paperback JNI bridge ---------------------------------------------------
add_library(paperback SHARED paperback_bridge.c)

target_include_directories(paperback PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/quickjs)

find_library(log-lib log)
target_link_libraries(paperback qjs m ${log-lib})
