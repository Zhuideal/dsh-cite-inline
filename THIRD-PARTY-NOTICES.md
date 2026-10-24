# Third-party notices

## dsh-add-to-chat

This project is a port of [choco9527/dsh-add-to-chat](https://github.com/choco9527/dsh-add-to-chat),
which is licensed under the MIT License.

The upstream revision this port is built from
(`51254305e7dbda9304b70ca7e74142dd8b6423bd`, "fix: carry quotes on the upstream
reference pipeline") is vendored verbatim at
[`tools/upstream-client.js`](tools/upstream-client.js). `client.js` is generated
from that file by [`tools/build-client.cjs`](tools/build-client.cjs), so the
upstream code is present in the distributed bundle.

```
MIT License

Copyright (c) choco9527

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Runtime dependencies

This package ships no third-party runtime dependencies. React, the DSH client
packages and the theme tokens it consumes are supplied by the host (DeepSeek
Harness) at runtime and are not redistributed here.
