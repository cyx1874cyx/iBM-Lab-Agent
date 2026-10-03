"""Internal stdio guardian: EOF owns shutdown; Windows Job owns descendants."""
import ctypes
import os
import signal
import subprocess
import sys
import threading


def windows_job(child):
    from ctypes import wintypes
    class Basic(ctypes.Structure):
        _fields_ = [('ProcessTime', ctypes.c_int64), ('JobTime', ctypes.c_int64),
                    ('Flags', wintypes.DWORD), ('Min', ctypes.c_size_t), ('Max', ctypes.c_size_t),
                    ('Active', wintypes.DWORD), ('Affinity', ctypes.c_size_t),
                    ('Priority', wintypes.DWORD), ('Scheduling', wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ('ReadOps', 'WriteOps', 'OtherOps', 'ReadBytes', 'WriteBytes', 'OtherBytes')]
    class Extended(ctypes.Structure):
        _fields_ = [('Basic', Basic), ('IO', IO), ('ProcessMemory', ctypes.c_size_t),
                    ('JobMemory', ctypes.c_size_t), ('PeakProcess', ctypes.c_size_t), ('PeakJob', ctypes.c_size_t)]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    info = Extended()
    info.Basic.Flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)) or not kernel.AssignProcessToJobObject(job, int(child._handle)):
        kernel.CloseHandle(job)
        raise ctypes.WinError(ctypes.get_last_error())
    return lambda: kernel.CloseHandle(job)


def main():
    if len(sys.argv) < 2:
        return 2
    child = subprocess.Popen(sys.argv[1:], stdin=subprocess.PIPE,
                             creationflags=0x08000004 if os.name == 'nt' else 0,
                             start_new_session=os.name != 'nt')
    stop_lock = threading.Lock()
    stop_owned = None
    try:
        if os.name == 'nt':
            stop_owned = windows_job(child)
            resume = ctypes.WinDLL('ntdll').NtResumeProcess
            resume.argtypes = [ctypes.c_void_p]
            if resume(int(child._handle)) != 0:
                raise RuntimeError('Cannot resume owned scientific process')
        else:
            stop_owned = lambda: os.killpg(child.pid, signal.SIGKILL)
        def stop():
            nonlocal stop_owned
            with stop_lock:
                action, stop_owned = stop_owned, None
                if action:
                    try:
                        action()
                    except ProcessLookupError:
                        pass
        def forward():
            try:
                while chunk := os.read(sys.stdin.fileno(), 65536):
                    child.stdin.write(chunk)
                    child.stdin.flush()
            except (BrokenPipeError, OSError):
                pass
            finally:
                stop()
        threading.Thread(target=forward, daemon=True).start()
        code = child.wait()
        stop()
        return code if code >= 0 else 1
    finally:
        if stop_owned:
            stop_owned()
        if child.poll() is None:
            child.kill()
            child.wait()


if __name__ == '__main__':
    raise SystemExit(main())
