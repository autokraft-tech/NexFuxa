You can reuse the same **View** for repeating components like pumps and valves.

![](images/fuxa-reuse-view1.gif)

You have to define a device as **internal** and some variable (Tag) and bind it to the controls of reusable **View**.
For example the title dialog and a variable for the input value.

![](images/fuxa-reuse-view2.gif)

Then define in every component the **Events** to open the dialog, where you map the internal tags to the device tags.

![](images/fuxa-reuse-view3.gif)

If you wish, you can also add a confirmation button.

![](images/fuxa-reuse-view4.gif)

## Extended Method: Shared detail page with Target Device

The core purpose of this feature is to dynamically display detailed data of multiple devices of the same type through one shared page template, avoiding separate detail pages for each device.

### Implementation Steps

1. Establish device connections and tags
Create two (or more) device connections of the same type in **Connections**.
Use exactly the same tag names under each device to keep data structure and references consistent.
![](images/target-devices.PNG)

2. Create view pages
Create two views:
- **Device List Page**: displays all devices and contains the "View Details" buttons.
- **Device Detail Page**: a reusable template for detailed device data.
![](images/create-views.png)

3. Configure navigation logic in list page buttons
On each "View Details" button:
- **Target Page**: set the shared Device Detail Page.
- **Target Device**: set the specific device for that button.
![](images/target-page.PNG)

4. Bind tags in the detail page template
In the detail page, bind variables using `@[tag_name]` (example: `@[device_name]`).
When opened from the list page with Target Device, placeholders are resolved against the selected device tags.
![](images/target-output.PNG)

- Chart configuration supports placeholders, so charts can be reused with the same dynamic device-binding approach.
![](images/454593563-dcf414b2-d256-4609-9851-a4f1557a8dff.png)


Summary:
One template page can show details for multiple devices. Clicking different device buttons opens the same detail page with the corresponding real-time data.

Reference and images:
- Discussion #2118: https://github.com/frangoteam/FUXA/discussions/2118

### Binding with internal adapter proxy
Internal connection adapter as UI proxy
You can define internal connection adapters and create tags bound to UI components independently of a specific device.
Via client-side scripts, assign which real device the internal adapter should reference at runtime.
Reads/writes are redirected to the selected device when tag names match.
![](images/454606636-a5c32db1-2da5-4900-8882-438b7c94ef86.png)
![](images/454606930-2c62e3fe-1994-46c9-9b3f-b2537eca881e.png)


Reference and images:
- Pull Request #1810: https://github.com/frangoteam/FUXA/pull/1810




## Faceplate prefix inheritance

For SVG Widgets with a [Binding Profile](HowTo-Widgets.md#prefix-binding), configure the host Symbol with **Prefix Binding**, its PLC Device and a complete Tag Prefix. In its Events tab, select Click → **Open Faceplate (Dialog)** or **Open Faceplate (Card)** and choose the shared detail View. In that View, set participating Widgets to **Inherit Faceplate Binding**. Leave Variables Mapping empty for those Widgets; copy the host Symbol and change only its prefix for another equipment instance.

Each opened View receives an immutable runtime copy of the source Device ID and parameters. The target's Binding Profile resolves existing Tags against that context; the effective values are not saved into the shared View definition. Inherit never falls back to fixed/manual targets when context or Tags are missing. Widgets configured with a fixed Prefix keep their own Device/parameters; Manual Widgets retain their existing bindings and Variables Mapping. Ordinary Output/Input/Shape controls retain their existing configuration and do not acquire Widget inheritance.

Concurrent Dialogs, Cards and Panels have independent runtime DOM IDs, Widget modules and subscription ownership. Closing one releases its resources while other instances keep updating, including when they display the same PLC instance. Runtime DOM IDs are distinct from saved View/Gauge definition IDs. Client scripts using `$getObject()` or `$invokeObject()` from a View resolve objects within that originating View instance; arbitrary scripts querying global DOM IDs must handle their own scope and cleanup. This read-only inheritance does not add PLC commands or configuration writes.
