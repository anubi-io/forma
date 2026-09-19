; Synthetic regression of the MakeraStudio export envelope seen in:
; https://github.com/MakeraInc/CarveraProfiles/blob/main/Sample_Files/TopClamp.nc
;@MKR|BEGIN
;@MKR|SCHEMA|v=1.0.0
;@MKR|CAM|id=MakeraStudio|name=MakeraStudio|v=1.0.0
;@MKR|STOCK|id=cuboid|length=40|width=40|height=10|diameter=1
;@MKR|TOOL|number=1|name=Test flat end|type=Flat End|diameter=3.175
;@MKR|END
G90 G21
;@MKR|TOOLPATH_START|toolpath_number=1
T1 M6
M7
G0 X10 Y10
S12000 M3
G0 Z5
G1 Z-1 F200
G1 X30 F500
G0 Z15
M9
M05
G28
M02
;(thumbnail_image_begin)
;aW1hZ2UgaXMgb25seSBhIGNvbW1lbnQ=
;(thumbnail_image_end)
