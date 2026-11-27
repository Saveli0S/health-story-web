"""Build valid synthetic ZIPs of exact lengths in an isolated scratch directory."""
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED

out=Path(sys.argv[1])
out.mkdir(parents=True,exist_ok=True)
def make(name,size):
    path=out/name
    marker='synthetic-medical-imaging.bin'
    # One stored member, no extras or comment; local + central headers + end record.
    payload=size-98-2*len(marker)
    if payload<=0: raise ValueError(size)
    block=bytes(range(251))*4096
    with ZipFile(path,'w',ZIP_STORED) as archive:
        with archive.open(marker,'w') as member:
            for offset in range(0,payload,len(block)):
                member.write(block[:min(len(block),payload-offset)])
    assert path.stat().st_size==size
M=1024*1024
# JSON-encoded "application/zip" and LF = 18 bytes, AES-GCM IV + tag = 28.
overhead=len(b'"application/zip"\n')+28
for name,size in [('legacy.zip',4096),('edge-v1.zip',16*M-overhead),('edge-v2.zip',16*M-overhead+1),('large.zip',17*M+251),('max.zip',128*M),('over.zip',128*M+1)]:
    make(name,size)
