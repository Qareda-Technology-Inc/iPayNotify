{
:put "QAREFI: 1 start"
:log warning "QAREFI: 1 start"
:local apibase "https://ipaynotifyserver.onrender.com"
:local orgid ""
:local sitename "auto"
:local lansubnet ""
:local regtoken ""
:local bootcode ""
:local wgiface "wg-qarefi"
:local wgpool "10.66.54.0/24"
:local vpnmgmt "QareFi: VPN management"

:put "QAREFI: 2 identity"
:if (($sitename = "") || ($sitename = "auto")) do={
  :set sitename [/system identity get name]
}
# Collapse spaces to single dash; keep only safe chars
:local guard 0
:while (([:find $sitename " "] != nil) && ($guard < 40)) do={
  :local sp [:find $sitename " "]
  :set sitename ([:pick $sitename 0 $sp] . "-" . [:pick $sitename ($sp + 1) [:len $sitename]])
  :set guard ($guard + 1)
}
:while (([:find $sitename "--"] != nil) && ($guard < 80)) do={
  :local sp [:find $sitename "--"]
  :set sitename ([:pick $sitename 0 $sp] . "-" . [:pick $sitename ($sp + 2) [:len $sitename]])
  :set guard ($guard + 1)
}
:if ([:len $sitename] < 2) do={ :set sitename "mt-site" }
:if ([:len $sitename] > 40) do={ :set sitename [:pick $sitename 0 40] }
:put ("QAREFI: 3 site=" . $sitename)

:put "QAREFI: 4 wireguard"
:do {
  :if ([:len [/interface wireguard find where name=$wgiface]] = 0) do={
    /interface wireguard add name=$wgiface listen-port=51820 mtu=1420 disabled=no comment="QareFi"
    :put "QAREFI: 4a created"
  } else={
    :put "QAREFI: 4a exists"
  }
} on-error={
  :put "QAREFI: FAIL need RouterOS 7 WireGuard"
  :error "no-wg"
}

:delay 2s
:local mypub [/interface wireguard get [find where name=$wgiface] public-key]
:if ([:len $mypub] < 40) do={
  :put "QAREFI: FAIL pubkey"
  :error "pubkey"
}
:put "QAREFI: 5 pubkey ok"
:put ("QAREFI: 5b keylen=" . [:len $mypub])
:if (([:len $mypub] < 40) || ([:len $mypub] > 50)) do={
  :put "QAREFI: FAIL pubkey length"
  :error "pubkey"
}

# Raw key goes in a header so + and / are not rewritten (those chars break URL and form bodies).
:local url ($apibase . "/api/routers/register?siteName=" . $sitename . "&format=rsc")
:if ([:len $lansubnet] > 0) do={ :set url ($url . "&lanSubnet=" . $lansubnet) }
:if ([:len $bootcode] > 0) do={
  :set url ($url . "&boot=" . $bootcode)
} else={
  :if ([:len $regtoken] > 0) do={ :set url ($url . "&token=" . $regtoken) }
}
:if ([:len $orgid] > 0) do={ :set url ($url . "&organizationId=" . $orgid) }
:local hdr ("X-Wg-Pubkey: " . $mypub)

:local tmpfile "qapply.rsc"
:do { /file remove [find where name=$tmpfile] } on-error={}
:put "QAREFI: 6 register"
:do {
  /tool fetch url=$url http-method=post http-data="ok=1" http-header-field=$hdr dst-path=$tmpfile mode=https keep-result=yes
} on-error={
  :put "QAREFI: FAIL register fetch"
  :do {
    :if ([:len [/file find where name=$tmpfile]] > 0) do={
      :put ("QAREFI: body=" . [/file get [find where name=$tmpfile] contents])
    }
  } on-error={}
  :error "fetch"
}
:delay 1s
:put "QAREFI: 7 import apply script"
/import file-name=$tmpfile
:do { /file remove [find where name=$tmpfile] } on-error={}
}
