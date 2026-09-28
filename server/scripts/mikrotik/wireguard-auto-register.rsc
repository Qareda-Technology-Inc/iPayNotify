# QareFi WireGuard auto-register (RouterOS v7+)
# Uses :put so Terminal shows progress during /import

{
:put "QAREFI: import started"
:log warning "QAREFI: import started"

:local apibase "https://ipaynotifyserver.onrender.com"
:local orgid ""
:local sitename "auto"
:local lansubnet "auto"
:local regtoken ""
:local wgiface "wg-qarefi"
:local wgport 51820
:local wgmtu 1420
:local wgpool "10.66.54.0/24"
:local vpnmgmt "QareFi: VPN management"

:if (($sitename = "") || ($sitename = "auto") || ($sitename = "site-unnamed")) do={
  :set sitename [/system identity get name]
}
:while ([:find $sitename " "] != nil) do={
  :local sp [:find $sitename " "]
  :set sitename ([:pick $sitename 0 $sp] . "-" . [:pick $sitename ($sp + 1) [:len $sitename]])
}
:if ([:len $sitename] < 2) do={
  :set sitename ("mt-" . [/system routerboard get serial-number])
}
:put ("QAREFI: site=" . $sitename)

:if (($lansubnet = "") || ($lansubnet = "auto")) do={
  :set lansubnet ""
  :do {
    :local dhcpnets [/ip dhcp-server network find]
    :if ([:len $dhcpnets] > 0) do={
      :set lansubnet [/ip dhcp-server network get [:pick $dhcpnets 0] address]
    }
  } on-error={}
  :if ([:len $lansubnet] = 0) do={
    :do {
      :local brids [/ip address find where interface~"bridge" && disabled=no]
      :if ([:len $brids] = 0) do={
        :set brids [/ip address find where interface="ether1" && disabled=no]
      }
      :if ([:len $brids] > 0) do={
        :local addr [/ip address get [:pick $brids 0] address]
        :local slash [:find $addr "/"]
        :if ($slash != nil) do={
          :local iponly [:pick $addr 0 $slash]
          :local d1 [:find $iponly "."]
          :local d2 [:find $iponly "." ($d1 + 1)]
          :local d3 [:find $iponly "." ($d2 + 1)]
          :if ($d3 != nil) do={
            :set lansubnet ([:pick $iponly 0 $d3] . ".0/24")
          }
        }
      }
    } on-error={}
  }
}
:put ("QAREFI: lan=" . $lansubnet)

:do {
  :if ([:len [/interface wireguard find where name=$wgiface]] = 0) do={
    /interface wireguard add name=$wgiface listen-port=$wgport mtu=$wgmtu disabled=no comment="QareFi auto VPN"
    :put "QAREFI: created wg interface"
  } else={
    :put "QAREFI: wg interface exists"
  }
} on-error={
  :put "QAREFI: FAILED - no WireGuard (need RouterOS 7+)"
  :log error "QAREFI: FAILED - WireGuard not available"
  :error "no wireguard"
}

:delay 2s
:local mypub ""
:do {
  :set mypub [/interface wireguard get [find where name=$wgiface] public-key]
} on-error={}
:if ([:len $mypub] < 40) do={
  :put "QAREFI: FAILED - cannot read public-key"
  :log error "QAREFI: FAILED - cannot read public-key"
  :error "missing public-key"
}
:put "QAREFI: pubkey ok"

:local httpdata ("publicKey=" . $mypub . "&siteName=" . $sitename)
:if ([:len $lansubnet] > 0) do={
  :set httpdata ($httpdata . "&lanSubnet=" . $lansubnet)
}
:if ([:len $regtoken] > 0) do={
  :set httpdata ($httpdata . "&token=" . $regtoken)
}
:if ([:len $orgid] > 0) do={
  :set httpdata ($httpdata . "&organizationId=" . $orgid)
}

:local url ($apibase . "/api/routers/register")
:local tmpfile "wg-register-response.txt"
:put ("QAREFI: posting " . $url)

:do {
  /tool fetch url=$url http-method=post http-data=$httpdata http-header-field="Content-Type: application/x-www-form-urlencoded" dst-path=$tmpfile keep-result=yes check-certificate=no
} on-error={
  :put "QAREFI: FAILED - register fetch error"
  :log error "QAREFI: FAILED - register fetch error"
  :error "fetch failed"
}

:if ([:len [/file find where name=$tmpfile]] = 0) do={
  :put "QAREFI: FAILED - no response file"
  :error "no response file"
}

:local raw [/file get [find where name=$tmpfile] contents]
:put ("QAREFI: response bytes=" . [:len $raw])
:if ([:len $raw] = 0) do={
  :put "QAREFI: FAILED - blank response"
  :error "blank response"
}

:local tunnelip ""
:local serverpub ""
:local endpoint ""
:local allowedips ""
:local okflag ""
:local errmsg ""

:local pos 0
:local textlen [:len $raw]
:while ($pos < $textlen) do={
  :local nl [:find $raw "\n" $pos]
  :local line ""
  :if ($nl = nil) do={
    :set line [:pick $raw $pos $textlen]
    :set pos $textlen
  } else={
    :set line [:pick $raw $pos $nl]
    :set pos ($nl + 1)
  }
  :local cr [:find $line "\r"]
  :if ($cr != nil) do={ :set line [:pick $line 0 $cr] }
  :local eq [:find $line "="]
  :if ($eq != nil) do={
    :local k [:pick $line 0 $eq]
    :local v [:pick $line ($eq + 1) [:len $line]]
    :if ($k = "tunnelIp") do={ :set tunnelip $v }
    :if ($k = "serverPublicKey") do={ :set serverpub $v }
    :if ($k = "endpoint") do={ :set endpoint $v }
    :if ($k = "allowedIps") do={ :set allowedips $v }
    :if ($k = "ok") do={ :set okflag $v }
    :if ($k = "error") do={ :set errmsg $v }
  }
}

:put ("QAREFI: ok=" . $okflag . " tunnel=" . $tunnelip . " err=" . $errmsg)
:if (($okflag != "true") || ([:len $tunnelip] = 0) || ([:len $serverpub] = 0) || ([:len $endpoint] = 0)) do={
  :put ("QAREFI: FAILED - register rejected: " . $errmsg)
  :log error ("QAREFI: FAILED - register rejected: " . $errmsg)
  :error ("registration failed: " . $errmsg)
}

:if ([:len $allowedips] = 0) do={ :set allowedips $wgpool }

:local colon [:find $endpoint ":"]
:if ($colon = nil) do={
  :put "QAREFI: FAILED - bad endpoint"
  :error "bad endpoint"
}
:local ephost [:pick $endpoint 0 $colon]
:local epport [:pick $endpoint ($colon + 1) [:len $endpoint]]

:local addrcomment "QareFi WG tunnel"
:if ([:len [/ip address find where interface=$wgiface comment=$addrcomment]] = 0) do={
  /ip address add address=($tunnelip . "/24") interface=$wgiface comment=$addrcomment
} else={
  /ip address set [find where interface=$wgiface comment=$addrcomment] address=($tunnelip . "/24")
}

:if ([:len [/interface wireguard peers find where interface=$wgiface public-key=$serverpub]] = 0) do={
  /interface wireguard peers add interface=$wgiface public-key=$serverpub endpoint-address=$ephost endpoint-port=$epport allowed-address=$allowedips persistent-keepalive=25s comment="QareFi VPS"
} else={
  /interface wireguard peers set [find where interface=$wgiface public-key=$serverpub] endpoint-address=$ephost endpoint-port=$epport allowed-address=$allowedips persistent-keepalive=25s comment="QareFi VPS"
}

:if ([:len [/ip firewall filter find where comment=$vpnmgmt]] = 0) do={
  :do {
    /ip firewall filter add chain=input action=accept src-address=$wgpool comment=$vpnmgmt place-before=0
  } on-error={
    /ip firewall filter add chain=input action=accept src-address=$wgpool comment=$vpnmgmt
  }
}

:do {
  :local sshid [/ip service find where name="ssh"]
  :if ([:len $sshid] > 0) do={ /ip service set $sshid disabled=no }
  :local apiid [/ip service find where name="api"]
  :if ([:len $apiid] > 0) do={ /ip service set $apiid disabled=no }
  :local wbid [/ip service find where name="winbox"]
  :if ([:len $wbid] > 0) do={ /ip service set $wbid disabled=no }
} on-error={}

:put ("QAREFI: SUCCESS tunnelIp=" . $tunnelip)
:log warning ("QAREFI: SUCCESS tunnelIp=" . $tunnelip)
:do { /file remove [find where name=$tmpfile] } on-error={}
}
