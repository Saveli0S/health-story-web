"""Test real PKCE, JWT validation, refresh and completed Responses events with synthetic transport."""
from io import BytesIO
import json
from pathlib import Path
import tempfile
import time
import sys
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import chatgpt_local as api
from cryptography.hazmat.primitives.asymmetric import rsa


class Flow(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        self.app=api.ChatGPT("http://127.0.0.1:8764",tmp.name)
        self.sid="synthetic-browser"
        self.key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        self.app.keys=Mock()
        self.app.keys.get_signing_key_from_jwt.return_value.key=self.key.public_key()

    def start(self):
        url=self.app.begin(self.sid)
        q=parse_qs(urlsplit(url).query)
        self.assertEqual(q["code_challenge_method"],["S256"])
        self.assertEqual(q["redirect_uri"],[self.app.origin+"/auth/callback"])
        return q

    def complete(self,wrong=False):
        q=self.start()
        identity=dict(sub="fake-subject",iss=api.ISSUER,aud="oaiapp_test",exp=int(time.time())+300,
                      iat=int(time.time()),nonce="wrong" if wrong else q["nonce"][0])
        issued=dict(id_token=api.jwt.encode(identity,self.key,algorithm="RS256"),scope=api.SCOPE,
                    expires_in=300,refresh_token="refresh-test",access_token="access-test")
        def token(req):
            fields=parse_qs(req.data.decode())
            import base64,hashlib
            self.assertEqual(base64.urlsafe_b64encode(hashlib.sha256(fields["code_verifier"][0].encode()).digest()).decode().rstrip("="),q["code_challenge"][0])
            return issued
        with patch.object(api,"read_json",side_effect=token):
            self.app.callback(self.sid,dict(state=q["state"],code=["test"],client_id=["oaiapp_test"]))

    def test_state_nonce_isolation(self):
        q=self.start()
        with self.assertRaises(api.ClientError):
            self.app.callback("other-browser",dict(state=q["state"],code=["test"]))
        with self.assertRaises(api.ClientError):self.complete(wrong=True)
        self.assertEqual(self.app.saved(self.sid),{})

    def test_session_and_conversation(self):
        self.complete()
        self.assertEqual(self.app.path(self.sid).stat().st_mode & 0o777,0o600)
        self.assertEqual(self.app.saved("other-browser"),{})
        new=api.ChatGPT(self.app.origin,self.app.folder)
        self.assertEqual(new.host,self.app.host)
        rec=new.saved(self.sid);rec["expires"]=0;api.write_private(new.path(self.sid),rec)
        def fixture(req):
            if req.full_url.endswith("/token"):
                self.assertEqual(parse_qs(req.data.decode())["refresh_token"],["refresh-test"])
                return dict(access_token="new-test",refresh_token="renewed-test",expires_in=500)
            self.assertEqual(req.get_header("Authorization"),"Bearer new-test")
            return {"models":[{"visibility":"list","slug":"synthetic"}]}
        messages=[{"role":"user","content":"one"},{"role":"assistant","content":"two"},{"role":"user","content":"three"}]
        def stream(req,timeout):
            self.assertEqual(req.full_url,api.API+"/responses")
            self.assertEqual(json.loads(req.data),dict(model="synthetic",input=messages,store=False,stream=True))
            return BytesIO(b'data: {"type":"response.output_text.delta","delta":"four"}\n\ndata: {"type":"response.completed"}\n')
        with patch.object(api,"read_json",side_effect=fixture),patch.object(api,"urlopen",side_effect=stream):
            self.assertEqual(new.reply(self.sid,messages)["answer"],"four")
        self.assertEqual(new.saved(self.sid)["refresh"],"renewed-test")
        with patch.object(api,"urlopen",return_value=BytesIO(b"")):
            self.assertTrue(new.disconnect(self.sid)["revoked"])
        self.assertFalse(new.saved(self.sid))

    def test_incomplete_and_invalid(self):
        with self.assertRaises(api.ClientError):api.answer_stream([b'data: {"type":"response.output_text.delta","delta":"partial"}'])
        with self.assertRaises(api.ClientError):self.app.reply(self.sid,[{"role":"assistant","content":"one"}])

if __name__=="__main__":unittest.main()
