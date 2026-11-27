"""Same-origin storage for encrypted profile revisions and immutable originals."""
import hashlib
import json
import os
import re
import sqlite3
from urllib.parse import urlsplit

ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
TOKEN = re.compile(r"[A-Za-z0-9_-]{43}\Z")
MAX_BODY = 128 * 1024 * 1024


def digest(value):
    return hashlib.sha256(value.encode("ascii")).hexdigest()


class SyncError(Exception):
    def __init__(self, status):
        self.status = status


class SyncStore:
    def __init__(self, filename):
        self.filename = filename
        os.close(os.open(filename, os.O_CREAT | os.O_RDWR, 0o600))
        with sqlite3.connect(filename) as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, admin TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS devices (family TEXT, id TEXT, token TEXT NOT NULL,
                    grants TEXT NOT NULL, revoked INTEGER DEFAULT 0, PRIMARY KEY(family,id), UNIQUE(family,token));
                CREATE TABLE IF NOT EXISTS objects (family TEXT, profile TEXT, name TEXT, revision INTEGER,
                    value BLOB NOT NULL, PRIMARY KEY(family,profile,name));
            """)

    def handle(self, h):
        try:
            parts = urlsplit(h.path).path.strip("/").split("/")[1:]
            if not parts or not all(ID.fullmatch(p) for p in parts):
                raise SyncError(404)
            origin = h.headers.get("Origin")
            if origin and urlsplit(origin).netloc != h.headers.get("Host"):
                raise SyncError(403)
            auth = h.headers.get("Authorization", "")
            if not auth.startswith("Bearer ") or not TOKEN.fullmatch(auth[7:]):
                raise SyncError(401)
            size = int(h.headers.get("Content-Length", "0"))
            if size < 0 or size > MAX_BODY:
                raise SyncError(413)
            body = h.rfile.read(size)
            if len(body) != size:
                raise SyncError(400)
            with sqlite3.connect(self.filename, timeout=10) as db:
                status, data, rev = self.dispatch(db, parts, h.command, digest(auth[7:]), body, h.headers.get("If-Match"))
            h.send_response(status)
            h.send_header("Content-Type", "application/octet-stream")
            h.send_header("Cache-Control", "no-store")
            if rev is not None:
                h.send_header("ETag", '"%d"' % rev)
            h.send_header("Content-Length", str(len(data)))
            h.end_headers()
            if data:
                h.wfile.write(data)
        except (SyncError, ValueError, KeyError, TypeError) as e:
            h.send_error(e.status if isinstance(e, SyncError) else 400)
        except sqlite3.Error:
            h.send_error(503)

    def dispatch(self, db, parts, method, token, body, match):
        family = parts[0]
        if method != "GET":
            db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT admin FROM families WHERE id=?", (family,)).fetchone()
        if len(parts) == 1 and method == "PUT":
            if row and row[0] != token:
                raise SyncError(403)
            db.execute("INSERT OR IGNORE INTO families VALUES(?,?)", (family, token))
            return 204, b"", None
        if not row:
            raise SyncError(404)
        admin = row[0] == token
        actor = None if admin else db.execute("SELECT grants,id FROM devices WHERE family=? AND token=? AND revoked=0", (family,token)).fetchone()
        if not admin and not actor:
            raise SyncError(403)
        if len(parts) == 3 and parts[1] == "devices" and admin:
            device = parts[2]
            old = db.execute("SELECT token,revoked FROM devices WHERE family=? AND id=?", (family,device)).fetchone()
            if method == "DELETE":
                if old:
                    db.execute("UPDATE devices SET revoked=1 WHERE family=? AND id=?", (family,device))
                return 204,b"",None
            if method != "PUT":
                raise SyncError(405)
            payload = json.loads(body)
            grants, device_token = payload["grants"], payload["tokenHash"]
            if not re.fullmatch("[a-f0-9]{64}",device_token) or not isinstance(grants,dict) or not grants:
                raise SyncError(400)
            if any(not ID.fullmatch(k) or v not in ["read","edit","self"] for k,v in grants.items()):
                raise SyncError(400)
            if old and (old[1] or old[0] != device_token):
                raise SyncError(403)
            db.execute("INSERT INTO devices(family,id,token,grants) VALUES(?,?,?,?) ON CONFLICT(family,id) DO UPDATE SET grants=excluded.grants",
                       (family,device,device_token,json.dumps(grants)))
            return 204,b"",None
        roster = len(parts) == 4 and parts[1] == "devices" and parts[3] == "roster"
        if roster:
            if not admin and (method != "GET" or actor[1] != parts[2]):
                raise SyncError(403)
            # A separate namespace prevents access through the medical record route.
            parts = [family, "profiles", "@device-" + parts[2], "roster"]
        if len(parts) != 4 or parts[1] != "profiles":
            raise SyncError(404)
        profile, name = parts[2:]
        if not roster and name not in ["records","consent"] and not name.startswith("blob-"):
            raise SyncError(404)
        if not admin and not roster:
            permission = json.loads(actor[0]).get(profile)
            if not permission or (method != "GET" and (permission == "read" or (name == "consent" and permission != "self"))):
                raise SyncError(403)
        key = (family,profile,name)
        if method == "GET":
            obj = db.execute("SELECT revision,value FROM objects WHERE family=? AND profile=? AND name=?",key).fetchone()
            if not obj:
                raise SyncError(404)
            return 200,obj[1],obj[0]
        if method != "PUT" or not body:
            raise SyncError(400)
        obj = db.execute("SELECT revision FROM objects WHERE family=? AND profile=? AND name=?",key).fetchone()
        rev = obj[0] if obj else 0
        if match != '"%d"' % rev or (obj and name.startswith("blob-")):
            raise SyncError(412)
        db.execute("INSERT INTO objects VALUES(?,?,?,?,?) ON CONFLICT(family,profile,name) DO UPDATE SET revision=excluded.revision,value=excluded.value",(*key,rev+1,body))
        return 204,b"",rev+1
