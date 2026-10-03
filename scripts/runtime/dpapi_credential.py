"""Private Windows credential import. Never used as a model-facing tool."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
from ctypes import wintypes


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def transform(value, protect=False):
    if os.name != 'nt':
        raise RuntimeError('DPAPI import is only available on Windows')
    raw = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
    source, target = Blob(len(value), raw), Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    function = crypt.CryptProtectData if protect else crypt.CryptUnprotectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ctypes.WinError(ctypes.get_last_error())
    kernel = ctypes.WinDLL('kernel32')
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.memset(target.data, 0, target.size)
        kernel.LocalFree(target.data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('path')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    path = Path(args.path).resolve()
    if args.self_test:
        value = 'synthetic-p4-credential-验收'.encode('utf-8')
        protected = transform(value, protect=True)
        path.write_bytes(protected)
        assert value not in protected and transform(protected) == value
        print(json.dumps({'ok': True, 'protectedSha256': hashlib.sha256(protected).hexdigest()}))
    else:
        if not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise RuntimeError('Invalid protected credential file')
        value = transform(path.read_bytes()).decode('utf-8')
        print(json.dumps({'value': value}))


if __name__ == '__main__':
    main()
