{
:put "QAREFI: start"
:log warning "QAREFI: start"
:local apibase "https://ipaynotifyserver.onrender.com"
:local orgid ""
:local sitename "auto"
:local lansubnet ""
:local regtoken ""
:local wgiface "wg-qarefi"
:local wgpool "10.66.54.0/24"
:local vpnmgmt "QareFi: VPN management"
:if (($sitename = "") || ($sitename = "auto")) do={
  :set sitename [/system identity get name]
}
:while ([:find $sitename " "] != nil) do={
  :local sp [:find $sitename " "]
  :set sitename ([:pick $sitename 0 $sp] . "-" . [:pick $sitename ($sp + 1) [:len $sitename]])
}
:if ([:len $sitename] < 2) do={ :set sitename "mt-site" }
:do {
  :if ([:len [/interface wireguard find where name=$wgiface]] = 0) do={
    /interface wireguard add name=$wgiface listen-port=51820 mtu=1420 disabled=no comment="QareFi"
  }
} on-error={ :put "QAREFI: FAIL no WG"; :error "no-wg" }
:delay 2s
:local mypub [/interface wireguard get [find where name=$wgiface] public-key]
:if ([:len $mypub] < 40) do={ :put "QAREFI: FAIL pubkey"; :error "pubkey" }
:local httpdata ("publicKey=" . $mypub . "&siteName=" . $sitename)
:if ([:len $lansubnet] > 0) do={ :set httpdata ($httpdata . "&lanSubnet=" . $lansubnet) }
:if ([:len $regtoken] > 0) do={ :set httpdata ($httpdata . "&token=" . $regtoken) }
:if ([:len $orgid] > 0) do={ :set httpdata ($httpdata . "&organizationId=" . $orgid) }
:local url ($apibase . "/api/routers/register")
:local tmpfile "wg-reg.txt"
:put "QAREFI: registering"
:do {
  /tool fetch url=$url http-method=post http-data=$httpdata http-header-field="Content-Type: application/x-www-form-urlencoded" dst-path=$tmpfile keep-result=yes check-certificate=no
} on-error={ :put "QAREFI: FAIL fetch"; :error "fetch" }
:local raw [/file get [find where name=$tmpfile] contents]
:local tunnelip ""; :local serverpub ""; :local endpoint ""; :local allowedips ""; :local okflag ""; :local errmsg ""
:local pos 0; :local textlen [:len $raw]
:while ($pos < $textlen) do={
  :local nl [:find $raw "\n" $pos]
  :local line ""
  :if ($nl = nil) do={ :set line [:pick $raw $pos $textlen]; :set pos $textlen } else={ :set line [:pick $raw $pos $nl]; :set pos ($nl + 1) }
  :local cr [:find $line "\r"]; :if ($cr != nil) do={ :set line [:pick $line 0 $cr] }
  :local eq [:find $line "="]
  :if ($eq != nil) do={
    :local k [:pick $line 0 $eq]; :local v [:pick $line ($eq + 1) [:len $line]]
    :if ($k = "tunnelIp") do={ :set tunnelip $v }
    :if ($k = "serverPublicKey") do={ :set serverpub $v }
    :if ($k = "endpoint") do={ :set endpoint $v }
    :if ($k = "allowedIps") do={ :set allowedips $v }
    :if ($k = "ok") do={ :set okflag $v }
    :if ($k = "error") do={ :set errmsg $v }
  }
}
:put ("QAREFI: ok=" . $okflag . " ip=" . $tunnelip . " err=" . $errmsg)
:if (($okflag != "true") || ([:len $tunnelip] = 0) || ([:len $serverpub] = 0) || ([:len $endpoint] = 0)) do={ :put ("QAREFI: FAIL " . $errmsg); :error "reg" }
:if ([:len $allowedips] = 0) do={ :set allowedips $wgpool }
:local colon [:find $endpoint ":"]
:local ephost [:pick $endpoint 0 $colon]
:local epport [:pick $endpoint ($colon + 1) [:len $endpoint]]
:if ([:len [/ip address find where interface=$wgiface comment="QareFi WG tunnel"]] = 0) do={
  /ip address add address=($tunnelip . "/24") interface=$wgiface comment="QareFi WG tunnel"
} else={
  /ip address set [find where interface=$wgiface comment="QareFi WG tunnel"] address=($tunnelip . "/24")
}
:if ([:len [/interface wireguard peers find where interface=$wgiface public-key=$serverpub]] = 0) do={
  /interface wireguard peers add interface=$wgiface public-key=$serverpub endpoint-address=$ephost endpoint-port=$epport allowed-address=$allowedips persistent-keepalive=25s comment="QareFi VPS"
} else={
  /interface wireguard peers set [find where interface=$wgiface public-key=$serverpub] endpoint-address=$ephost endpoint-port=$epport allowed-address=$allowedips persistent-keepalive=25s comment="QareFi VPS"
}
:if ([:len [/ip firewall filter find where comment=$vpnmgmt]] = 0) do={
  :do { /ip firewall filter add chain=input action=accept src-address=$wgpool comment=$vpnmgmt place-before=0 } on-error={ /ip firewall filter add chain=input action=accept src-address=$wgpool comment=$vpnmgmt }
}
:put ("QAREFI: SUCCESS " . $tunnelip)
:log warning ("QAREFI: SUCCESS " . $tunnelip)
:do { /file remove [find where name=$tmpfile] } on-error={}
}
