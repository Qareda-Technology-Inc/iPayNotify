# WireGuard auto-register for RouterOS v7+
# ASCII only. Locals without underscores (import-safe).
# Usage: /tool fetch ... dst-path=qarefi-install.rsc ; /import qarefi-install.rsc

{
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

:log info "wg-auto-register: starting"

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
:log info ("wg-auto-register: siteName=" . $sitename)

:if (($lansubnet = "") || ($lansubnet = "auto")) do={
  :set lansubnet ""
  :local dhcpNets [/ip dhcp-server network find]
  :if ([:len $dhcpNets] > 0) do={
    :set lansubnet [/ip dhcp-server network get ($dhcpNets->0) address]
    :log info ("wg-auto-register: LAN from DHCP network=" . $lansubnet)
  }
  :if ([:len $lansubnet] = 0) do={
    :local brIds [/ip address find where interface~"bridge" && disabled=no]
    :if ([:len $brIds] = 0) do={
      :set brIds [/ip address find where interface="ether1" && disabled=no]
    }
    :if ([:len $brIds] > 0) do={
      :local addr [/ip address get ($brIds->0) address]
      :local slash [:find $addr "/"]
      :if ($slash != nil) do={
        :local ipOnly [:pick $addr 0 $slash]
        :local d1 [:find $ipOnly "."]
        :local d2 [:find $ipOnly "." ($d1 + 1)]
        :local d3 [:find $ipOnly "." ($d2 + 1)]
        :if ($d3 != nil) do={
          :local prefix [:pick $ipOnly 0 $d3]
          :set lansubnet ($prefix . ".0/24")
          :log info ("wg-auto-register: LAN from interface IP=" . $lansubnet)
        }
      }
    }
  }
}
:if ([:len $lansubnet] > 0) do={
  :log info ("wg-auto-register: lanSubnet=" . $lansubnet)
} else={
  :log warning "wg-auto-register: lanSubnet empty (optional)"
}

:if ([:len [/interface wireguard find where name=$wgiface]] = 0) do={
  /interface wireguard add name=$wgiface listen-port=$wgport mtu=$wgmtu disabled=no comment="QareFi auto VPN"
  :log info ("wg-auto-register: created interface " . $wgiface)
} else={
  :log info ("wg-auto-register: interface exists " . $wgiface)
}

:delay 2s
:local mypub [/interface wireguard get [find where name=$wgiface] public-key]
:if ([:len $mypub] < 40) do={
  :log error "wg-auto-register: FAILED - could not read local public-key"
  :error "missing public-key"
}
:log info ("wg-auto-register: local public-key ok len=" . [:len $mypub])

:local httpData ("publicKey=" . $mypub . "&siteName=" . $sitename)
:if ([:len $lansubnet] > 0) do={
  :set httpData ($httpData . "&lanSubnet=" . $lansubnet)
}
:if ([:len $regtoken] > 0) do={
  :set httpData ($httpData . "&token=" . $regtoken)
}
:if ([:len $orgid] > 0) do={
  :set httpData ($httpData . "&organizationId=" . $orgid)
}

:local url ($apibase . "/api/routers/register")
:local tmpFile "wg-register-response.txt"

:log info ("wg-auto-register: posting to " . $url)

:do {
  /tool fetch url=$url http-method=post http-data=$httpData http-header-field="Content-Type: application/x-www-form-urlencoded" dst-path=$tmpFile keep-result=yes check-certificate=no
} on-error={
  :log error "wg-auto-register: FAILED - /tool fetch error (DNS, TLS, or URL)"
  :error "fetch failed"
}

:if ([:len [/file find where name=$tmpFile]] = 0) do={
  :log error "wg-auto-register: FAILED - empty fetch result"
  :error "no response file"
}

:local raw [/file get [find where name=$tmpFile] contents]
:if ([:len $raw] = 0) do={
  :log error "wg-auto-register: FAILED - blank response body"
  :error "blank response"
}

:local tunnelIp ""
:local serverpub ""
:local endpoint ""
:local allowedIps ""
:local okFlag ""
:local errMsg ""

:local pos 0
:local textLen [:len $raw]
:while ($pos < $textLen) do={
  :local nl [:find $raw "\n" $pos]
  :local line ""
  :if ($nl = nil) do={
    :set line [:pick $raw $pos $textLen]
    :set pos $textLen
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
    :if ($k = "tunnelIp") do={ :set tunnelIp $v }
    :if ($k = "serverPublicKey") do={ :set serverpub $v }
    :if ($k = "endpoint") do={ :set endpoint $v }
    :if ($k = "allowedIps") do={ :set allowedIps $v }
    :if ($k = "ok") do={ :set okFlag $v }
    :if ($k = "error") do={ :set errMsg $v }
  }
}

:if (($okFlag != "true") || ([:len $tunnelIp] = 0) || ([:len $serverpub] = 0) || ([:len $endpoint] = 0)) do={
  :log error ("wg-auto-register: FAILED - ok=" . $okFlag . " error=" . $errMsg)
  :error ("registration failed: " . $errMsg)
}

:if ([:len $allowedIps] = 0) do={ :set allowedIps $wgpool }

:local colon [:find $endpoint ":"]
:if ($colon = nil) do={
  :log error "wg-auto-register: FAILED - endpoint missing port"
  :error "bad endpoint"
}
:local epHost [:pick $endpoint 0 $colon]
:local epPort [:pick $endpoint ($colon + 1) [:len $endpoint]]

:log info ("wg-auto-register: assigned tunnelIp=" . $tunnelIp)

:local addrComment "QareFi WG tunnel"
:if ([:len [/ip address find where interface=$wgiface comment=$addrComment]] = 0) do={
  /ip address add address=($tunnelIp . "/24") interface=$wgiface comment=$addrComment
} else={
  /ip address set [find where interface=$wgiface comment=$addrComment] address=($tunnelIp . "/24")
}

:if ([:len [/interface wireguard peers find where interface=$wgiface public-key=$serverpub]] = 0) do={
  /interface wireguard peers add interface=$wgiface public-key=$serverpub endpoint-address=$epHost endpoint-port=$epPort allowed-address=$allowedIps persistent-keepalive=25s comment="QareFi VPS"
} else={
  /interface wireguard peers set [find where interface=$wgiface public-key=$serverpub] endpoint-address=$epHost endpoint-port=$epPort allowed-address=$allowedIps persistent-keepalive=25s comment="QareFi VPS"
}

:if ([:len [/ip firewall filter find where comment=$vpnmgmt]] = 0) do={
  :do {
    /ip firewall filter add chain=input action=accept src-address=$wgpool comment=$vpnmgmt place-before=0
  } on-error={
    /ip firewall filter add chain=input action=accept src-address=$wgpool comment=$vpnmgmt
  }
}

:do {
  :local sshId [/ip service find where name="ssh"]
  :if ([:len $sshId] > 0) do={ /ip service set $sshId disabled=no }
  :local apiId [/ip service find where name="api"]
  :if ([:len $apiId] > 0) do={ /ip service set $apiId disabled=no }
  :local wbId [/ip service find where name="winbox"]
  :if ([:len $wbId] > 0) do={ /ip service set $wbId disabled=no }
} on-error={}

:log info ("wg-auto-register: SUCCESS - tunnelIp=" . $tunnelIp . " - finish Add router in QareFi with SSH login")
:do { /file remove [find where name=$tmpFile] } on-error={}
}
