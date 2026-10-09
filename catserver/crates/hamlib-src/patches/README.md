# Hamlib 4.7.2 diagnostic patch

The managed builder applies this patch before configure on Linux and Windows. It checks the complete original `src/rig.c` and `include/hamlib/rig.h` hashes, then replaces one exact section in each file. Source changes fail the build. Cargo watches `build.rs`, `src`, and `patches`. The source archive remains unchanged.

`rigerror2` and `rigerror` return thread-local storage, which means each thread has its own buffer. GNU `__thread` supports the GCC and Clang Linux toolchains and x86_64 MinGW. A returned pointer remains valid until the same function runs again on that thread, or the thread exits. The two functions use separate buffers. The constant out-of-range result does not change.

`rigerror` appends its error and copies the recent history under the existing history mutex. The patch keeps the existing limit of 20 lines and the existing history trimming rules. It also checks the actual history length before append. Overflow logging runs after unlock and bypasses the history macro to prevent recursive append.

The GNU C `rig_debug` macro uses a local formatter buffer instead of the shared deprecated `debugmsgsave2` buffer. The callback still receives the original format and arguments. `debug.c` retains its existing callback serialization. `rig_debug_clear`, including the call from `rig_open`, uses the same history mutex through a new function. Existing exported history arrays remain available with the same size and type. Direct access to those arrays requires the caller to prevent concurrent native use.

`HAMLIB_SOURCE_DIR` accepts only the exact supported already-patched diagnostic source and header. The builder validates these files without changing them. A pristine or modified override fails with an error that recommends the managed builder. After configure, an accepted override runs `make clean` before the normal build and install. This rebuild prevents stale unpatched objects from reaching the installed archive. This requirement is narrower than the previous override behavior. The builder still modifies build outputs in the caller-owned directory, as it did before.

The maintained Linux C tests link this build's actual static archive. They test immediate copies, ordered cross-thread pointer lifetime, retained history, concurrent debug/history/clear calls, callback re-entry, and overflow callback re-entry. The Rust test checks the wrapper's owned error fields. Incorrect-message counts must equal zero. The C tests require `cc`, `pkg-config`, pthread barriers, and `timeout`.

Run the tests from `catserver`:

```sh
HAMLIB_SOURCE_NETWORK=0 CARGO_TARGET_DIR=/tmp/hamlib-fixed-target \
  cargo test --offline -j4 -p hamlib-src -p hamlib-sys -p hamlib -- --nocapture
HAMLIB_SOURCE_NETWORK=0 CARGO_TARGET_DIR=/tmp/hamlib-fixed-target \
  cargo check --offline -j4 -p hamlib --target x86_64-pc-windows-gnu
```

The target directory needs the managed archive cache for offline builds. Windows compilation does not establish Windows runtime behavior. The C runtime tests require Linux.

The ordinary immediate-copy test on unpatched Hamlib intentionally exercises the known data race. That baseline execution has undefined behavior. The coordinated baseline test avoids simultaneous reads and writes and demonstrates the shared-storage lifetime failure. After the patch, cross-thread writes cannot change returned error storage.
